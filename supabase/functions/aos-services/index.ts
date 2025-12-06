import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { pathname } = new URL(req.url);

    // Route: HuggingFace AI Proxy
    if (pathname.endsWith("/ai")) {
      return await handleAIRequest(req);
    }

    // Route: Paystack Payment Verification
    if (pathname.endsWith("/verify-payment")) {
      return await handlePaymentVerification(req);
    }

    // Route: Create Gift Order
    if (pathname.endsWith("/create-gift")) {
      return await handleCreateGift(req);
    }

    // Route: Get Received Gifts
    if (pathname.endsWith("/get-gifts")) {
      return await handleGetGifts(req);
    }

    return new Response(JSON.stringify({ error: "Endpoint not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// HuggingFace API Key Provider
async function handleAIRequest(req: Request) {
  const HF_API_KEY = Deno.env.get("HUGGINGFACE_API_KEY");

  if (!HF_API_KEY) {
    return new Response(
      JSON.stringify({ error: "HuggingFace API key not configured" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  return new Response(
    JSON.stringify({
      success: true,
      apiKey: HF_API_KEY,
    }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

// Paystack Payment Verification Handler
async function handlePaymentVerification(req: Request) {
  const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY");

  if (!PAYSTACK_SECRET_KEY) {
    return new Response(
      JSON.stringify({ error: "Paystack secret key not configured" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const { reference } = await req.json();

  if (!reference) {
    return new Response(
      JSON.stringify({ error: "Payment reference is required" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  try {
    // Verify payment with Paystack
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error("Payment verification failed");
    }

    const data = await response.json();

    if (data.data.status === "success") {
      // Payment successful, update database
      const supabaseClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      );

      // Extract order_id from metadata
      const orderId = data.data.metadata?.order_id;

      if (orderId) {
        const { error: updateError } = await supabaseClient
          .from("gift_orders")
          .update({
            payment_status: "completed",
            payment_verified: true,
            payment_reference: reference,
            verified_at: new Date().toISOString(),
            paystack_data: data.data,
          })
          .eq("id", orderId);

        if (updateError) {
          console.error("Error updating gift order:", updateError);
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          verified: true,
          amount: data.data.amount / 100, // Convert from kobo/pesewas to main currency
          customer: data.data.customer,
          metadata: data.data.metadata,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    } else {
      return new Response(
        JSON.stringify({
          success: false,
          verified: false,
          message: "Payment was not successful",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// Create Gift Order Handler
async function handleCreateGift(req: Request) {
  const {
    sender_name,
    sender_email,
    recipient_name,
    recipient_email,
    gift_type,
    gift_amount,
    message,
    payment_reference,
  } = await req.json();

  if (
    !sender_name ||
    !sender_email ||
    !recipient_name ||
    !recipient_email ||
    !gift_type ||
    !gift_amount
  ) {
    return new Response(JSON.stringify({ error: "Missing required fields" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data, error } = await supabaseClient
      .from("gift_orders")
      .insert({
        sender_name,
        sender_email,
        recipient_name,
        recipient_email,
        gift_type,
        gift_amount,
        message,
        payment_reference,
        payment_status: payment_reference ? "pending" : "unpaid",
        payment_verified: false,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return new Response(JSON.stringify({ success: true, order: data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// Get Received Gifts Handler
async function handleGetGifts(req: Request) {
  const { recipient_email } = await req.json();

  if (!recipient_email) {
    return new Response(
      JSON.stringify({ error: "Recipient email is required" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data, error } = await supabaseClient
      .from("gift_orders")
      .select(
        "id, sender_name, sender_email, recipient_name, recipient_email, gift_type, gift_amount, message, created_at"
      )
      .eq("recipient_email", recipient_email)
      .eq("payment_verified", true)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return new Response(JSON.stringify({ success: true, gifts: data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

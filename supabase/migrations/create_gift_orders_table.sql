-- Create gift_orders table
CREATE TABLE IF NOT EXISTS gift_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_name TEXT NOT NULL,
    sender_email TEXT NOT NULL,
    recipient_name TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    gift_type TEXT NOT NULL,
    gift_amount DECIMAL(10, 2) NOT NULL,
    message TEXT,
    payment_reference TEXT UNIQUE,
    payment_status TEXT DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'pending', 'completed', 'failed')),
    payment_verified BOOLEAN DEFAULT FALSE,
    verified_at TIMESTAMPTZ,
    paystack_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on payment reference
CREATE INDEX idx_gift_orders_payment_reference ON gift_orders(payment_reference);

-- Create index on email fields
CREATE INDEX idx_gift_orders_sender_email ON gift_orders(sender_email);
CREATE INDEX idx_gift_orders_recipient_email ON gift_orders(recipient_email);

-- Create index on payment status
CREATE INDEX idx_gift_orders_payment_status ON gift_orders(payment_status);

-- Enable Row Level Security
ALTER TABLE gift_orders ENABLE ROW LEVEL SECURITY;

-- Create policy for authenticated users to view their own orders
CREATE POLICY "Users can view their own gift orders"
    ON gift_orders
    FOR SELECT
    USING (
        auth.email() = sender_email OR 
        auth.email() = recipient_email
    );

-- Create policy for anyone to insert orders (for anonymous gift purchases)
CREATE POLICY "Anyone can create gift orders"
    ON gift_orders
    FOR INSERT
    WITH CHECK (true);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_gift_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER gift_orders_updated_at
    BEFORE UPDATE ON gift_orders
    FOR EACH ROW
    EXECUTE FUNCTION update_gift_orders_updated_at();

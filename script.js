// State
let windows = [];
let highestZIndex = 1;
let startMenuOpen = false;
let currentUser = null;
let isAdminUser = false;
let bootComplete = false;
let highPerformanceMode = false;
let userPreferences = {
  wallpaper: "aurora",
  theme: "dark",
  highPerformance: false,
};

// Performance optimization - detect low-end devices
(function detectPerformance() {
  const isLowEnd =
    navigator.hardwareConcurrency <= 4 ||
    navigator.deviceMemory <= 4 ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );

  if (isLowEnd) {
    document.body.classList.add("high-performance");
    highPerformanceMode = true;
    // High performance mode enabled for better smoothness
  }
})();

// Toggle high performance mode
function toggleHighPerformanceMode(enable) {
  highPerformanceMode = enable;
  if (enable) {
    document.body.classList.add("high-performance");
  } else {
    document.body.classList.remove("high-performance");
  }
  userPreferences.highPerformance = enable;
  saveUserPreferences();
}

if (typeof window.marked?.setOptions === "function") {
  window.marked.setOptions({
    breaks: true,
    gfm: true,
  });
}

const FILE_MANAGER_COLLECTIONS = ["projects", "updates", "users"];
const fileManagerCache = {};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Firebase Auth State Observer
function initFirebaseAuth() {
  if (window.firebaseAuth && window.onAuthStateChanged) {
    // Setting up Firebase auth listener...

    window.onAuthStateChanged(window.firebaseAuth, async (user) => {
      // Auth state changed
      currentUser = user;
      if (user) {
        // User signed in
        await createOrUpdateUserProfile(user);
        loadUserPreferences();
        updateUIForUser(user);
      } else {
        // User signed out
        updateUIForUser(null);
      }
      // Complete boot animation after auth check
      completeBootSequence();
    });
  } else {
    console.error("Firebase auth not available");
    // Complete boot even if auth fails
    completeBootSequence();
  }
}

// Create or update user profile in Firestore
async function createOrUpdateUserProfile(user) {
  if (!window.firebaseDb || !user) return;

  try {
    const userRef = doc(window.firebaseDb, "users", user.uid);
    const userDoc = await getDoc(userRef);

    const userData = {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || user.email?.split("@")[0] || "User",
      photoURL: user.photoURL || "",
      lastLogin: new Date(),
      updatedAt: new Date(),
    };

    if (!userDoc.exists()) {
      // Create new user profile
      await setDoc(userRef, {
        ...userData,
        friends: [],
        createdAt: new Date(),
      });
      console.log("User profile created in database");
    } else {
      // Update existing user profile
      await updateDoc(userRef, {
        lastLogin: new Date(),
        updatedAt: new Date(),
        displayName: userData.displayName,
        photoURL: userData.photoURL,
      });
      console.log("User profile updated in database");
    }
  } catch (error) {
    console.error("Error creating/updating user profile:", error);
  }
}

// Load user preferences from localStorage
function loadUserPreferences() {
  try {
    const savedPrefs = localStorage.getItem("aos_userPreferences");
    if (savedPrefs) {
      const prefs = JSON.parse(savedPrefs);
      userPreferences = { ...userPreferences, ...prefs };
      applyUserPreferences();

      // Apply high performance mode if saved
      if (prefs.highPerformance) {
        toggleHighPerformanceMode(true);
      }
    }
  } catch (error) {
    console.error("Error loading user preferences:", error);
  }
}

// Save user preferences to localStorage
function saveUserPreferences() {
  try {
    localStorage.setItem(
      "aos_userPreferences",
      JSON.stringify(userPreferences)
    );
  } catch (error) {
    console.error("Error saving user preferences:", error);
  }
}

// Extract dominant colors from an image
async function extractImageColors(imageSrc) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // Sample pixels (every 10th pixel for performance)
      const colors = [];
      for (let i = 0; i < data.length; i += 40) {
        // 4 bytes per pixel * 10
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const alpha = data[i + 3];

        if (alpha > 128) {
          // Only consider opaque pixels
          colors.push([r, g, b]);
        }
      }

      // Find dominant colors using k-means clustering (simplified)
      const dominantColors = findDominantColors(colors, 3);

      // Convert to HSL for better color analysis
      const hslColors = dominantColors.map((rgb) =>
        rgbToHsl(rgb[0], rgb[1], rgb[2])
      );

      // Sort by saturation and lightness to find accent color
      hslColors.sort((a, b) => b[1] * b[2] - a[1] * a[2]); // Saturation * Lightness

      const accentColor = hslColors[0];
      const bgColor = hslColors[hslColors.length - 1]; // Most muted color for background

      resolve({
        accent: hslToRgb(accentColor[0], accentColor[1], accentColor[2]),
        background: hslToRgb(bgColor[0], bgColor[1], bgColor[2]),
      });
    };
    img.onerror = () => {
      // Fallback to default colors if image fails to load
      resolve({
        accent: [99, 102, 241], // Default blue
        background: [15, 23, 42], // Default dark
      });
    };
    img.src = imageSrc;
  });
}

// Simple k-means clustering to find dominant colors
function findDominantColors(colors, k) {
  if (colors.length === 0) return [[128, 128, 128]];

  // Initialize centroids randomly
  let centroids = [];
  for (let i = 0; i < k; i++) {
    centroids.push(colors[Math.floor(Math.random() * colors.length)]);
  }

  // Run k-means for a few iterations
  for (let iter = 0; iter < 10; iter++) {
    const clusters = Array.from({ length: k }, () => []);

    // Assign points to nearest centroid
    colors.forEach((color) => {
      let minDist = Infinity;
      let closestCentroid = 0;

      centroids.forEach((centroid, index) => {
        const dist = colorDistance(color, centroid);
        if (dist < minDist) {
          minDist = dist;
          closestCentroid = index;
        }
      });

      clusters[closestCentroid].push(color);
    });

    // Update centroids
    centroids = centroids.map((centroid, index) => {
      const cluster = clusters[index];
      if (cluster.length === 0) return centroid;

      const sum = cluster.reduce(
        (acc, color) => [
          acc[0] + color[0],
          acc[1] + color[1],
          acc[2] + color[2],
        ],
        [0, 0, 0]
      );

      return [
        Math.round(sum[0] / cluster.length),
        Math.round(sum[1] / cluster.length),
        Math.round(sum[2] / cluster.length),
      ];
    });
  }

  return centroids;
}

// Calculate Euclidean distance between two RGB colors
function colorDistance(color1, color2) {
  return Math.sqrt(
    Math.pow(color1[0] - color2[0], 2) +
      Math.pow(color1[1] - color2[1], 2) +
      Math.pow(color1[2] - color2[2], 2)
  );
}

// Convert RGB to HSL
function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h,
    s,
    l = (max + min) / 2;

  if (max === min) {
    h = s = 0; // achromatic
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return [h, s, l];
}

// Convert HSL to RGB
function hslToRgb(h, s, l) {
  let r, g, b;

  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// Apply user preferences to UI
function applyUserPreferences() {
  const desktop = document.getElementById("desktop");
  const body = document.body;

  if (desktop) {
    // Remove existing wallpaper classes
    desktop.className = desktop.className.replace(/wallpaper-\w+/g, "");
    // Add current wallpaper
    desktop.classList.add(`wallpaper-${userPreferences.wallpaper}`);
  }

  if (body) {
    // Remove existing theme classes
    body.className = body.className.replace(/theme-\w+/g, "");

    // Reset dynamic theme colors
    resetDynamicTheme();

    // Check if this is an image wallpaper
    const imageWallpapers = [
      "aos-image",
      "pexels-bri-schneiter-28802-346529",
      "pexels-cottonbro-9695151",
      "pexels-haugenzhays-1798631",
      "pexels-maxfrancis-2246476",
      "pexels-pedro-figueras-202443-681467",
      "pexels-quang-nguyen-vinh-222549-2166711",
      "pexels-therato-1933320",
    ];
    if (imageWallpapers.includes(userPreferences.wallpaper)) {
      // Apply dynamic theme based on image colors
      applyImageTheme(userPreferences.wallpaper);
    } else {
      // Add static theme based on wallpaper
      body.classList.add(`theme-${userPreferences.wallpaper}`);
    }
  }
}

// Apply dynamic theme based on image colors
async function applyImageTheme(wallpaper) {
  const body = document.body;
  const root = document.documentElement;

  try {
    let imageSrc = "";
    switch (wallpaper) {
      case "aos-image":
        imageSrc = "assets/AOS.jpg";
        break;
      default:
        // For other images, don't extract colors to improve performance
        break;
    }

    if (imageSrc) {
      const colors = await extractImageColors(imageSrc);

      const accentRgb = colors.accent;
      const luminance =
        (0.299 * accentRgb[0] + 0.587 * accentRgb[1] + 0.114 * accentRgb[2]) /
        255;
      const isLightAccent = luminance > 0.5;

      // For image wallpapers, always use dark taskbar with light text for visibility
      const taskbar = document.querySelector(".taskbar");
      if (taskbar) {
        taskbar.classList.add("taskbar-dark");
        taskbar.classList.remove("taskbar-light");
      }

      // Make start button dark for image wallpapers
      const startButton = document.querySelector(".start-button");
      if (startButton) {
        startButton.classList.add("start-button-dark");
      }

      // Make tray icons dark for image wallpapers
      const trayIcons = document.querySelectorAll(".tray-icon");
      trayIcons.forEach((icon) => {
        icon.classList.add("tray-icon-dark");
      });

      // Make clock dark for image wallpapers
      const clock = document.querySelector(".clock");
      if (clock) {
        clock.classList.add("clock-dark");
      }

      // Set icon text colors for contrast
      const iconPrimary = isLightAccent ? "#1f2937" : "#ffffff";
      const iconSecondary = isLightAccent ? "#6b7280" : "#e0f2ff";

      root.style.setProperty("--icon-primary", iconPrimary);
      root.style.setProperty("--icon-secondary", iconSecondary);

      // Apply extracted colors as CSS variables
      root.style.setProperty(
        "--text-accent",
        `rgb(${colors.accent[0]}, ${colors.accent[1]}, ${colors.accent[2]})`
      );
      root.style.setProperty(
        "--border-primary",
        `rgba(${colors.accent[0]}, ${colors.accent[1]}, ${colors.accent[2]}, 0.3)`
      );
      root.style.setProperty(
        "--border-secondary",
        `rgba(${colors.accent[0]}, ${colors.accent[1]}, ${colors.accent[2]}, 0.2)`
      );
      root.style.setProperty(
        "--icon-bg",
        `rgba(${colors.accent[0]}, ${colors.accent[1]}, ${colors.accent[2]}, 0.8)`
      );
      root.style.setProperty(
        "--icon-bg-hover",
        `rgba(${colors.accent[0]}, ${colors.accent[1]}, ${colors.accent[2]}, 0.9)`
      );
    }

    // Add base theme class for other properties
    body.classList.add("theme-mono"); // Use mono as base since it's dark
  } catch (error) {
    console.error("Error extracting image colors:", error);
    // Fallback to static theme
    body.classList.add(`theme-${wallpaper}`);
  }
}

// Reset dynamic theme colors when switching away from image wallpapers
function resetDynamicTheme() {
  const root = document.documentElement;
  root.style.removeProperty("--text-accent");
  root.style.removeProperty("--border-primary");
  root.style.removeProperty("--border-secondary");
  root.style.removeProperty("--icon-bg");
  root.style.removeProperty("--icon-bg-hover");
  root.style.removeProperty("--icon-primary");
  root.style.removeProperty("--icon-secondary");

  // Reset taskbar styles
  const taskbar = document.querySelector(".taskbar");
  if (taskbar) {
    taskbar.classList.remove("taskbar-light", "taskbar-dark");
  }

  // Reset start button styles
  const startButton = document.querySelector(".start-button");
  if (startButton) {
    startButton.classList.remove("start-button-dark");
  }

  // Reset tray icon styles
  const trayIcons = document.querySelectorAll(".tray-icon");
  trayIcons.forEach((icon) => {
    icon.classList.remove("tray-icon-dark");
  });

  // Reset clock styles
  const clock = document.querySelector(".clock");
  if (clock) {
    clock.classList.remove("clock-dark");
  }
}

// Update UI based on auth state
function updateUIForUser(user) {
  const userNameElement = document.querySelector(".user-name");
  const userAvatar = document.querySelector(".user-avatar");
  const authButton = document.getElementById("authButton");
  const loginOverlay = document.getElementById("loginOverlay");
  const desktop = document.getElementById("desktop");
  const taskbar = document.querySelector(".taskbar");

  if (user) {
    // Check if user is admin
    isAdminUser = user.email === "stevejupiter4@gmail.com";

    // User is signed in - show OS, hide login overlay
    if (loginOverlay) loginOverlay.classList.add("hidden");
    if (desktop) desktop.style.display = "block";
    if (taskbar) taskbar.style.display = "flex";

    if (userNameElement)
      userNameElement.textContent =
        user.displayName ||
        user.user_metadata?.full_name ||
        user.email ||
        "User";
    if (userAvatar) {
      userAvatar.innerHTML = user.photoURL
        ? `<img src="${user.photoURL}" alt="Avatar" style="width: 100%; height: 100%; border-radius: 16px; object-fit: cover;">`
        : user.displayName?.charAt(0).toUpperCase() ||
          user.user_metadata?.full_name?.charAt(0).toUpperCase() ||
          user.email?.charAt(0).toUpperCase() ||
          "U";
    }
    if (authButton) authButton.textContent = "Sign Out";

    // Re-render start menu to show/hide admin features
    renderStartMenu();
  } else {
    // User is signed out
    isAdminUser = false;

    // User is signed out - hide OS, show login overlay
    if (loginOverlay) loginOverlay.classList.remove("hidden");
    if (desktop) desktop.style.display = "none";
    if (taskbar) taskbar.style.display = "none";

    if (userNameElement) userNameElement.textContent = "Guest User";
    if (userAvatar) userAvatar.innerHTML = "G";
    if (authButton) authButton.textContent = "Sign In";
  }
}

// Google Sign In with Firebase
async function signInWithGoogle() {
  console.log("signInWithGoogle called");
  if (
    !window.firebaseAuth ||
    !window.GoogleAuthProvider ||
    !window.signInWithPopup
  ) {
    console.error("Firebase auth not available");
    return;
  }

  try {
    console.log("Attempting Firebase OAuth sign in...");
    const provider = new window.GoogleAuthProvider();
    const result = await window.signInWithPopup(window.firebaseAuth, provider);
    console.log("Firebase OAuth successful:", result.user.email);
  } catch (error) {
    console.error("Firebase sign in error:", error);
    alert("Sign in failed: " + error.message);
  }
}

// Sign Out with Firebase
async function signOutUser() {
  if (!window.firebaseAuth || !window.signOut) return;

  try {
    await window.signOut(window.firebaseAuth);
    console.log("Signed out successfully");
  } catch (error) {
    console.error("Sign out error:", error);
  }
}

// Apps data
const apps = [
  { id: "browser", title: "Browser", iconClass: "fa-solid fa-globe" },
  { id: "files", title: "My Files", iconClass: "fa-solid fa-folder-open" },
  {
    id: "documents",
    title: "Documents",
    iconClass: "fa-regular fa-file-lines",
  },
  { id: "pictures", title: "Pictures", iconClass: "fa-regular fa-image" },
  { id: "music", title: "Music", iconClass: "fa-solid fa-music" },
  { id: "videos", title: "Videos", iconClass: "fa-solid fa-film" },
  { id: "terminal", title: "Terminal", iconClass: "fa-solid fa-terminal" },
  {
    id: "calculator",
    title: "Calculator",
    iconClass: "fa-solid fa-calculator",
  },
  { id: "calendar", title: "Calendar", iconClass: "fa-regular fa-calendar" },
  { id: "mail", title: "Mail", iconClass: "fa-regular fa-envelope" },
  { id: "messages", title: "Messages", iconClass: "fa-regular fa-comments" },
  { id: "settings", title: "Settings", iconClass: "fa-solid fa-gear" },
  {
    id: "database",
    title: "Supabase Database",
    iconClass: "fa-solid fa-database",
  },
  { id: "resume", title: "Resume", iconClass: "fa-solid fa-id-card" },
  {
    id: "projects",
    title: "Projects",
    iconClass: "fa-solid fa-diagram-project",
  },
  { id: "github", title: "GitHub", iconClass: "fa-brands fa-github" },
  { id: "contact", title: "Contact", iconClass: "fa-solid fa-paper-plane" },
  {
    id: "testimonials",
    title: "Testimonials",
    iconClass: "fa-solid fa-people-group",
  },
  { id: "about", title: "About AOS", iconClass: "fa-solid fa-user-astronaut" },
  { id: "ai-assistant", title: "AOS AI", iconClass: "fa-solid fa-robot" },
];

// Initialize
function init() {
  // Load user preferences (wallpaper/theme) immediately
  loadUserPreferences();

  // Initially hide OS interface until user signs in
  const desktop = document.getElementById("desktop");
  const taskbar = document.querySelector(".taskbar");
  if (desktop) desktop.style.display = "none";
  if (taskbar) taskbar.style.display = "none";

  updateClock();
  setInterval(updateClock, 1000);
  renderStartMenu();
  setupEventListeners();
  setupWallpaperPicker();
  initFirebaseAuth();
  setupStartMenuSearch();
  setupFeaturedCards();
  setupQuickActions();
}

// Update clock
function updateClock() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const dateStr = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  document.querySelector(".clock-time").textContent = timeStr;
  document.querySelector(".clock-date").textContent = dateStr;
}

// Render start menu apps
function renderStartMenu() {
  const container = document.getElementById("startMenuApps");

  // Start with regular apps
  let menuItems = apps
    .map(
      (app) => `
      <button class="app-item" data-app-id="${app.id}">
          <i class="icon ${app.iconClass}"></i>
          <span>${app.title}</span>
      </button>
  `
    )
    .join("");

  // Add admin upload button if user is admin
  if (isAdminUser) {
    menuItems += `
      <div style="border-top: 1px solid rgba(255,255,255,0.1); margin: 8px 0; padding-top: 8px;">
        <button class="app-item admin-item" data-app-id="upload-projects" style="background: rgba(255,107,53,0.1); border: 1px solid #ff6b35;">
            <i class="icon fa-solid fa-upload" style="color: #ff6b35;"></i>
            <span style="color: #ff6b35;">Upload Projects</span>
        </button>
      </div>
    `;
  }

  container.innerHTML = menuItems;

  // Add click handlers
  container.querySelectorAll(".app-item").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const appId = btn.dataset.appId;

      if (appId === "upload-projects") {
        // Handle upload projects action
        showUploadProjectsModal();
      } else {
        const app = apps.find((a) => a.id === appId);
        if (app) {
          openWindow(app.title, app.iconClass);
        }
      }
    });
  });
}

// Setup event listeners
function setupEventListeners() {
  // Start button
  document.getElementById("startButton").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleStartMenu();
  });

  // Start menu (prevent closing when clicking inside)
  document.getElementById("startMenu").addEventListener("click", (e) => {
    e.stopPropagation();
  });

  // Auth button
  const authButton = document.getElementById("authButton");
  if (authButton) {
    authButton.addEventListener("click", () => {
      if (currentUser) {
        signOutUser();
      } else {
        signInWithGoogle();
      }
    });
  }

  // Settings button in start menu
  const settingsButton = document.querySelector(".btn-settings");
  if (settingsButton) {
    settingsButton.addEventListener("click", () => {
      openWindow("Settings", "fa-solid fa-gear");
      closeStartMenu();
    });
  }

  // Login button
  const loginButton = document.getElementById("loginButton");
  if (loginButton) {
    loginButton.addEventListener("click", () => {
      signInWithGoogle();
    });
  }

  // Desktop click (close start menu)
  document.getElementById("desktop").addEventListener("click", () => {
    closeStartMenu();
  });

  // Floating AI button
  const floatingAIButton = document.getElementById("floatingAIButton");
  if (floatingAIButton) {
    floatingAIButton.addEventListener("click", (e) => {
      e.stopPropagation();
      openWindow("AOS AI", "fa-solid fa-robot");
    });
  }

  // Desktop icons double click
  document.querySelectorAll(".desktop-icon").forEach((icon) => {
    let clickCount = 0;
    let clickTimer = null;

    icon.addEventListener("click", (e) => {
      e.stopPropagation();
      clickCount++;

      if (clickCount === 1) {
        clickTimer = setTimeout(() => {
          clickCount = 0;
        }, 300);
      } else if (clickCount === 2) {
        clearTimeout(clickTimer);
        clickCount = 0;

        const iconId = icon.dataset.id;
        const title = icon.querySelector("span").textContent;
        const iconClass = icon.dataset.icon || "fa-solid fa-window-maximize";
        openWindow(title, iconClass);
      }
    });
  });
}

// Toggle start menu
function toggleStartMenu() {
  startMenuOpen = !startMenuOpen;
  const menu = document.getElementById("startMenu");
  const btn = document.getElementById("startButton");

  if (startMenuOpen) {
    menu.classList.remove("hidden");
    btn.classList.add("active");
  } else {
    menu.classList.add("hidden");
    btn.classList.remove("active");
  }
}

// Close start menu
function closeStartMenu() {
  startMenuOpen = false;
  document.getElementById("startMenu").classList.add("hidden");
  document.getElementById("startButton").classList.remove("active");
}

// Open window
function openWindow(title, iconClass) {
  // Check if window already exists
  const existing = windows.find((w) => w.title === title);
  if (existing) {
    focusWindow(existing.id);
    if (existing.isMinimized) {
      restoreWindow(existing.id);
    }
    return;
  }

  const id = Date.now().toString();
  const window = {
    id,
    title,
    iconClass,
    isMinimized: false,
    position: { x: 100 + windows.length * 30, y: 80 + windows.length * 30 },
    size: { width: 600, height: 400 },
    zIndex: ++highestZIndex,
  };

  windows.push(window);
  renderWindow(window);
  renderTaskbar();
  closeStartMenu();
}

// Render window
function renderWindow(window) {
  const container = document.getElementById("windowsContainer");
  const div = document.createElement("div");
  div.className = "window";
  div.id = `window-${window.id}`;
  div.style.left = `${window.position.x}px`;
  div.style.top = `${window.position.y}px`;
  div.style.width = `${window.size.width}px`;
  div.style.height = `${window.size.height}px`;
  div.style.zIndex = window.zIndex;

  div.innerHTML = `
        <div class="window-inner">
            <div class="window-titlebar">
                <div class="window-title">
                    <i class="icon ${window.iconClass}"></i>
                    <span>${window.title}</span>
                </div>
                <div class="window-controls">
                    <button class="window-btn minimize-btn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                    </button>
                    <button class="window-btn maximize-btn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="15 3 21 3 21 9"></polyline>
                            <polyline points="9 21 3 21 3 15"></polyline>
                            <line x1="21" y1="3" x2="14" y2="10"></line>
                            <line x1="3" y1="21" x2="10" y2="14"></line>
                        </svg>
                    </button>
                    <button class="window-btn close-btn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="window-content">
                ${getWindowContent(window.title, window.iconClass)}
            </div>
        </div>
    `;

  container.appendChild(div);

  // Initialize window-specific experiences
  if (window.title === "Terminal") {
    setupTerminal(div);
  } else if (window.title === "Projects") {
    loadProjectsFromFirebase();
  } else if (window.title === "My Files") {
    initFileManager();
  } else if (window.title === "Messages") {
    initMessagesApp();
  } else if (window.title === "AOS AI") {
    initAIAssistant();
    // Scroll AI chat to bottom when window opens
    setTimeout(() => {
      const aiChatContainer = document.getElementById("ai-chat-container");
      if (aiChatContainer) {
        aiChatContainer.scrollTop = aiChatContainer.scrollHeight;
      }
    }, 100);
  } else if (window.title === "Calculator") {
    initCalculator(div);
  } else if (window.title === "Calendar") {
    initCalendar(div);
  } else if (window.title === "Browser") {
    initBrowser(div);
  } else if (window.title === "Testimonials") {
    initTestimonials(div);
  } else if (window.title === "Mail") {
    initMail(div);
  } else if (window.title === "Settings") {
    initSettings(div);
  } else if (window.title === "Gift Creator") {
    initGiftCreator(div);
  } else if (window.title === "Pictures") {
    initPictures(div);
  } else if (window.title === "Music") {
    initMusic(div);
  } else if (window.title === "Videos") {
    initVideos(div);
  } else if (window.title === "Documents") {
    initDocuments(div);
  } else if (window.title === "Database") {
    // Automatically load all files when database window opens
    setTimeout(() => loadCollection("all_files"), 100);
  }

  // Add event listeners
  const titlebar = div.querySelector(".window-titlebar");
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };

  titlebar.addEventListener("mousedown", (e) => {
    if (e.target.closest(".window-controls")) return;

    focusWindow(window.id);
    isDragging = true;
    div.classList.add("dragging"); // Performance optimization
    dragOffset = {
      x: e.clientX - window.position.x,
      y: e.clientY - window.position.y,
    };
  });

  document.addEventListener("mousemove", (e) => {
    if (isDragging) {
      const newX = e.clientX - dragOffset.x;
      const newY = e.clientY - dragOffset.y;
      window.position = { x: newX, y: newY };
      div.style.left = `${newX}px`;
      div.style.top = `${newY}px`;
    }
  });

  document.addEventListener("mouseup", () => {
    if (isDragging) {
      div.classList.remove("dragging"); // Performance optimization
    }
    isDragging = false;
  });

  div
    .querySelector(".minimize-btn")
    .addEventListener("click", () => minimizeWindow(window.id));
  div
    .querySelector(".maximize-btn")
    .addEventListener("click", () => maximizeWindow(window.id));
  div
    .querySelector(".close-btn")
    .addEventListener("click", () => closeWindow(window.id));

  div.addEventListener("mousedown", () => focusWindow(window.id));
}

// Focus window
function focusWindow(id) {
  const window = windows.find((w) => w.id === id);
  if (!window) return;

  window.zIndex = ++highestZIndex;
  const elem = document.getElementById(`window-${id}`);
  if (elem) {
    elem.style.zIndex = window.zIndex;
  }
}

// Maximize window
function maximizeWindow(id) {
  const window = windows.find((w) => w.id === id);
  if (!window) return;

  const elem = document.getElementById(`window-${id}`);
  if (!elem) return;

  if (window.isMaximized) {
    // Restore to original size
    elem.style.left = `${window.originalPosition.x}px`;
    elem.style.top = `${window.originalPosition.y}px`;
    elem.style.width = `${window.originalSize.width}px`;
    elem.style.height = `${window.originalSize.height}px`;
    window.isMaximized = false;
  } else {
    // Save original position and size
    window.originalPosition = { ...window.position };
    window.originalSize = { ...window.size };

    // Maximize to full screen (minus taskbar)
    elem.style.left = "0px";
    elem.style.top = "0px";
    elem.style.width = "100vw";
    elem.style.height = "calc(100vh - 72px)";
    window.isMaximized = true;
  }
}

// Minimize window
function minimizeWindow(id) {
  const window = windows.find((w) => w.id === id);
  if (!window) return;

  window.isMinimized = true;
  const elem = document.getElementById(`window-${id}`);
  if (elem) {
    elem.style.display = "none";
  }
  renderTaskbar();
}

// Restore window
function restoreWindow(id) {
  const window = windows.find((w) => w.id === id);
  if (!window) return;

  window.isMinimized = false;
  const elem = document.getElementById(`window-${id}`);
  if (elem) {
    elem.style.display = "block";
  }
  focusWindow(id);
  renderTaskbar();
}

// Close window
function closeWindow(id) {
  const window = windows.find((w) => w.id === id);

  // Clear AI memory when AI window is closed
  if (window && window.title === "AOS AI") {
    aiConversationHistory = [];
    localStorage.removeItem("aos_ai_memory");
  }

  windows = windows.filter((w) => w.id !== id);
  const elem = document.getElementById(`window-${id}`);
  if (elem) {
    elem.remove();
  }
  renderTaskbar();
}

// Render taskbar
function renderTaskbar() {
  const container = document.getElementById("taskbarWindows");
  container.innerHTML = windows
    .map(
      (w) => `
        <div class="taskbar-window-container">
          <button class="taskbar-window ${
            w.isMinimized ? "minimized" : "active"
          }" data-window-id="${w.id}">
              <i class="icon ${w.iconClass}"></i>
              <span>${w.title}</span>
          </button>
          <button class="taskbar-close-btn" data-window-id="${
            w.id
          }" title="Close window">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
    `
    )
    .join("");

  // Add click handlers for window buttons
  container.querySelectorAll(".taskbar-window").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      // Don't trigger if clicking on close button area
      if (e.target.closest(".taskbar-close-btn")) return;

      const windowId = btn.dataset.windowId;
      const window = windows.find((w) => w.id === windowId);
      if (window) {
        if (window.isMinimized) {
          restoreWindow(windowId);
        } else {
          focusWindow(windowId);
        }
      }
    });
  });

  // Add click handlers for close buttons
  container.querySelectorAll(".taskbar-close-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const windowId = btn.dataset.windowId;
      closeWindow(windowId);
    });
  });
}

// Get window content based on type
function getWindowContent(title, iconClass) {
  const portfolioContent = {
    "My Files": `
      <div style="padding: 20px; height: 100%; display: flex; flex-direction: column;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
          <div>
            <h2 style="margin: 0; display: flex; align-items: center; gap: 8px;">
              <i class="fa-solid fa-folder-open"></i>
              My Files
            </h2>
            <p style="margin: 6px 0 0 0; color: #94a3b8;">Browse every Firestore collection like a file explorer.</p>
          </div>
          <button id="file-manager-refresh" style="padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(148,163,184,0.4); background: rgba(148,163,184,0.1); color: #e2e8f0; cursor: pointer;">
            <i class="fa-solid fa-rotate"></i>
            Reload
          </button>
        </div>
        <div style="margin-top: 16px; flex: 1; display: grid; grid-template-columns: 260px 1fr; gap: 16px; min-height: 0;">
          <div id="file-tree" style="background: rgba(255,255,255,0.03); border-radius: 12px; padding: 16px; overflow-y: auto; border: 1px solid rgba(255,255,255,0.08);">
            <p style="color: #94a3b8;">Sign in to view your files.</p>
          </div>
          <div id="file-preview" style="background: rgba(255,255,255,0.03); border-radius: 12px; padding: 16px; border: 1px solid rgba(255,255,255,0.08); overflow-y: auto;">
            <p style="color: #94a3b8;">Select a document from the left pane to view its fields.</p>
          </div>
        </div>
      </div>
    `,
    Resume: `
      <div style="padding: 20px; height: 100%; overflow-y: auto; background: radial-gradient(circle at top, rgba(255,107,53,0.12), rgba(15,23,42,0.95)); color: white;">
        <div style="max-width: 900px; margin: 0 auto; display: flex; flex-direction: column; gap: 24px;">
          <!-- Hero -->
          <section style="padding: 28px; border-radius: 20px; background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 40px 120px rgba(15,23,42,0.6);">
            <p style="margin: 0; text-transform: uppercase; letter-spacing: 0.25rem; font-size: 12px; color: #94a3b8;">Freelance Product Engineer</p>
            <h1 style="margin: 12px 0 4px 0; font-size: 40px; letter-spacing: -0.02em;">Stephen J. Amuzu</h1>
            <p style="margin: 0; font-size: 18px; color: #cbd5f5; max-width: 580px;">
              I help founders, agencies, and in-house teams ship premium web & mobile experiences—fast. Mix of product strategy, hands-on engineering, and tasteful UI polish.
            </p>
            <div style="display: flex; flex-wrap: wrap; gap: 16px; margin-top: 20px; font-size: 14px; color: #e2e8f0;">
              <span style="display: inline-flex; align-items: center; gap: 8px;"><i class="fa-regular fa-envelope" style="color: #ff6b35;"></i> stevejupiter4@gmail.com</span>
              <span style="display: inline-flex; align-items: center; gap: 8px;"><i class="fa-solid fa-phone" style="color: #ff6b35;"></i> +233 53 297 3455</span>
              <span style="display: inline-flex; align-items: center; gap: 8px;"><i class="fa-solid fa-earth-africa" style="color: #ff6b35;"></i> Working remote • GMT</span>
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-top: 24px;">
              <div style="padding: 12px; border-radius: 16px; background: rgba(255,255,255,0.04);">
                <p style="margin: 0; font-size: 32px; font-weight: 600;">40+</p>
                <span style="color: #94a3b8; font-size: 13px;">products launched</span>
              </div>
              <div style="padding: 12px; border-radius: 16px; background: rgba(255,255,255,0.04);">
                <p style="margin: 0; font-size: 32px; font-weight: 600;">12</p>
                <span style="color: #94a3b8; font-size: 13px;">active retainers</span>
              </div>
              <div style="padding: 12px; border-radius: 16px; background: rgba(255,255,255,0.04);">
                <p style="margin: 0; font-size: 32px; font-weight: 600;">3</p>
                <span style="color: #94a3b8; font-size: 13px;">continents served</span>
              </div>
            </div>
          </section>

          <!-- Services -->
          <section style="padding: 24px; border-radius: 18px; background: rgba(15,23,42,0.85); border: 1px solid rgba(148,163,184,0.2);">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
              <h2 style="margin: 0; font-size: 22px;">How I help</h2>
              <span style="color: #94a3b8; font-size: 14px;">Fixed-price sprints or flexible retainers</span>
            </div>
            <div style="margin-top: 16px; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px;">
              <article style="padding: 16px; border-radius: 14px; background: rgba(255,255,255,0.03); border: 1px solid rgba(56,189,248,0.2);">
                <h3 style="margin: 0 0 8px 0; font-size: 16px; color: #38bdf8;">MVP Accelerator</h3>
                <p style="margin: 0; color: #cbd5f5; font-size: 14px;">Turn a loose concept into a clickable prototype or revenue-ready build in 4–6 weeks.</p>
              </article>
              <article style="padding: 16px; border-radius: 14px; background: rgba(255,255,255,0.03); border: 1px solid rgba(16,185,129,0.2);">
                <h3 style="margin: 0 0 8px 0; font-size: 16px; color: #34d399;">Product Rescue</h3>
                <p style="margin: 0; color: #cbd5f5; font-size: 14px;">Untangle legacy codebases, boost performance, and re-align UX for scaling teams.</p>
              </article>
              <article style="padding: 16px; border-radius: 14px; background: rgba(255,255,255,0.03); border: 1px solid rgba(249,115,22,0.2);">
                <h3 style="margin: 0 0 8px 0; font-size: 16px; color: #fb923c;">Fractional CTO</h3>
                <p style="margin: 0; color: #cbd5f5; font-size: 14px;">Guide roadmaps, recruit, and ship mission-critical features without the full-time overhead.</p>
              </article>
            </div>
          </section>

          <!-- Recent engagements -->
          <section style="padding: 24px; border-radius: 18px; background: rgba(15,23,42,0.85); border: 1px solid rgba(148,163,184,0.2);">
            <h2 style="margin: 0 0 12px 0; font-size: 22px;">Selected freelance work</h2>
            <div style="display: flex; flex-direction: column; gap: 16px;">
              <article style="padding: 16px; border-radius: 14px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05);">
                <div style="display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
                  <div>
                    <p style="margin: 0; font-size: 14px; color: #94a3b8;">SaaS Founder • 2024</p>
                    <h3 style="margin: 2px 0 6px 0;">Revenue Intelligence Dashboard</h3>
                  </div>
                  <span style="font-size: 13px; color: #38bdf8;">React · Supabase · Tailwind</span>
                </div>
                <p style="margin: 0; color: #cbd5f5; line-height: 1.6;">Designed and delivered a subscription analytics suite with role-based access, inline experimentation, and automated reporting. Helped the client close a $250k pre-seed round.</p>
              </article>
              <article style="padding: 16px; border-radius: 14px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05);">
                <div style="display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
                  <div>
                    <p style="margin: 0; font-size: 14px; color: #94a3b8;">Boutique Agency • 2023</p>
                    <h3 style="margin: 2px 0 6px 0;">Luxury Commerce Platform</h3>
                  </div>
                  <span style="font-size: 13px; color: #38bdf8;">Next.js · Shopify · Cloudflare</span>
                </div>
                <p style="margin: 0; color: #cbd5f5; line-height: 1.6;">Built a bespoke storefront + admin kit, integrating client’s ERP and enabling 3-hour content deployments. Result: 38% lift in AOV within the first quarter.</p>
              </article>
            </div>
          </section>

          <!-- Stack / toolbox -->
          <section style="padding: 24px; border-radius: 18px; background: rgba(15,23,42,0.85); border: 1px solid rgba(148,163,184,0.2);">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px;">
              <div>
                <h3 style="margin: 0 0 8px 0; color: #38bdf8;">Core Stack</h3>
                <ul style="margin: 0; padding-left: 18px; color: #cbd5f5; line-height: 1.6; font-size: 14px;">
                  <li>React / Next.js / React Native</li>
                  <li>Expo, Supabase, Firebase</li>
                  <li>Node.js, Express, Nitro</li>
                  <li>Tailwind, Framer Motion, Radix</li>
                </ul>
              </div>
              <div>
                <h3 style="margin: 0 0 8px 0; color: #38bdf8;">Delivery Muscle</h3>
                <ul style="margin: 0; padding-left: 18px; color: #cbd5f5; line-height: 1.6; font-size: 14px;">
                  <li>Rapid prototyping & design systems</li>
                  <li>API design + integrations</li>
                  <li>Testing culture & automation</li>
                  <li>Team onboarding & docs</li>
                </ul>
              </div>
              <div>
                <h3 style="margin: 0 0 8px 0; color: #38bdf8;">Freelance Extras</h3>
                <ul style="margin: 0; padding-left: 18px; color: #cbd5f5; line-height: 1.6; font-size: 14px;">
                  <li>Weekly check-ins & Loom updates</li>
                  <li>Transparent Trello/Linear boards</li>
                  <li>NDA-friendly + white-label ready</li>
                  <li>Timezone-flexible collaboration</li>
                </ul>
              </div>
            </div>
          </section>

          <!-- CTA -->
          <section style="padding: 24px; border-radius: 18px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2); text-align: center;">
            <h2 style="margin: 0 0 12px 0;">Booking new freelance partnerships</h2>
            <p style="margin: 0 0 16px 0; color: #0f172a; font-weight: 500;">2 build sprints available for Q1. Tell me about your product, and I’ll send back a roadmap + quote within 48 hours.</p>
            <button style="padding: 12px 28px; border-radius: 999px; background: #0f172a; border: none; color: white; cursor: pointer; font-size: 15px; font-weight: 600;">
              <i class="fa-solid fa-calendar-check" style="margin-right: 8px;"></i>Book a discovery call
            </button>
          </section>
        </div>
      </div>
    `,
    Projects: `
      <div style="padding: 20px; height: 100%; overflow-y: auto;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
          <div>
            <h2 style="display: flex; align-items: center; gap: 8px; margin: 0;">
              <i class="fa-solid fa-diagram-project"></i>
              Projects
            </h2>
            <p style="margin: 6px 0 0 0; color: #94a3b8;">
              Explore live data synced from Firebase.
            </p>
          </div>
          <div style="display: flex; gap: 8px;">
            ${
              currentUser?.email === "stevejupiter4@gmail.com"
                ? `
              <button onclick="showUploadProjectsModal()" style="padding: 8px 16px; border-radius: 8px; border: 1px solid rgba(255,107,53,0.4); background: rgba(255,107,53,0.15); color: #ff6b35; cursor: pointer;">
                <i class="fa-solid fa-upload"></i>
                Upload Projects
              </button>
            `
                : ""
            }
            <button onclick="loadProjectsFromFirebase()" style="padding: 8px 16px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(56,189,248,0.15); color: #38bdf8; cursor: pointer;">
              <i class="fa-solid fa-rotate"></i>
              Refresh
            </button>
          </div>
        </div>
        <div id="projects-grid" style="margin-top: 24px; display: grid; gap: 16px;">
          <p style="color: #94a3b8;">Loading projects from Firebase...</p>
        </div>
      </div>
    `,
    GitHub: `
      <div style="padding: 20px;">
        <h2><i class="fa-brands fa-github"></i> GitHub</h2>
        <p style="margin: 16px 0;">Check out my open-source contributions and personal projects on GitHub.</p>
        <button style="padding: 10px 20px; border-radius: 12px; background: #24292e; border: none; color: white; cursor: pointer; margin-top: 20px;" onclick="window.open('https://github.com/Stephen-J4455', '_blank')">Visit GitHub Profile</button>
      </div>
    `,
    Contact: `
      <div style="padding: 20px;">
        <h2><i class="fa-solid fa-paper-plane"></i> Contact Me</h2>
        <p style="margin: 16px 0;">Let's build something amazing together. Reach out for collaborations or opportunities.</p>
        <div style="margin-top: 24px; display: flex; flex-direction: column; gap: 16px;">
          <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px;">
            <i class="fa-solid fa-envelope" style="width: 24px; color: #38bdf8; font-size: 18px;"></i>
            <div style="flex: 1;">
              <div style="font-size: 12px; color: #94a3b8; margin-bottom: 2px;">Email</div>
              <a href="mailto:stevejupiter4@gmail.com" style="color: #e2e8f0; text-decoration: none;">stevejupiter4@gmail.com</a>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px;">
            <i class="fa-solid fa-phone" style="width: 24px; color: #10b981; font-size: 18px;"></i>
            <div style="flex: 1;">
              <div style="font-size: 12px; color: #94a3b8; margin-bottom: 2px;">Phone</div>
              <a href="tel:+233532973455" style="color: #e2e8f0; text-decoration: none;">+233 53 297 3455</a>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px;">
            <i class="fa-brands fa-linkedin" style="width: 24px; color: #0077b5; font-size: 18px;"></i>
            <div style="flex: 1;">
              <div style="font-size: 12px; color: #94a3b8; margin-bottom: 2px;">LinkedIn</div>
              <a href="https://www.linkedin.com/in/stephen-amuzu" target="_blank" style="color: #e2e8f0; text-decoration: none;">linkedin.com/in/stephen-amuzu</a>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px;">
            <i class="fa-brands fa-github" style="width: 24px; color: #6e5494; font-size: 18px;"></i>
            <div style="flex: 1;">
              <div style="font-size: 12px; color: #94a3b8; margin-bottom: 2px;">GitHub</div>
              <a href="https://github.com/Stephen-J4455" target="_blank" style="color: #e2e8f0; text-decoration: none;">github.com/Stephen-J4455</a>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px;">
            <i class="fa-solid fa-globe" style="width: 24px; color: #f59e0b; font-size: 18px;"></i>
            <div style="flex: 1;">
              <div style="font-size: 12px; color: #94a3b8; margin-bottom: 2px;">Portfolio</div>
              <a href="https://stephenj.vercel.app" target="_blank" style="color: #e2e8f0; text-decoration: none;">stephenj.vercel.app</a>
            </div>
          </div>
        </div>
      </div>
    `,
    Testimonials: `
      <div style="padding: 20px;">
        <h2><i class="fa-solid fa-people-group"></i> Testimonials</h2>
        <p style="margin: 16px 0;">What clients and colleagues say about working with me.</p>
        <div style="margin-top: 24px; display: grid; gap: 16px;">
          <div style="padding: 16px; border-radius: 12px; background: rgba(255,255,255,0.04); border-left: 3px solid #38bdf8; backdrop-filter: blur(16px);">
            <p style="font-style: italic; margin-bottom: 12px;">"Outstanding work ethic and technical expertise. Delivered beyond expectations."</p>
            <p style="font-size: 14px; color: #94a3b8;">- Project Manager, Tech Corp</p>
          </div>
          <div style="padding: 16px; border-radius: 12px; background: rgba(255,255,255,0.04); border-left: 3px solid #38bdf8; backdrop-filter: blur(16px);">
            <p style="font-style: italic; margin-bottom: 12px;">"Creative problem solver with excellent communication skills."</p>
            <p style="font-size: 14px; color: #94a3b8;">- CEO, Startup Inc</p>
          </div>
        </div>
      </div>
    `,
    Settings: `
      <div style="padding: 20px; height: 100%; overflow-y: auto;">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
          <i class="fa-solid fa-gear" style="font-size: 24px; color: #38bdf8;"></i>
          <h2 style="margin: 0;">Settings</h2>
        </div>
        <div id="settings-content" style="display: flex; flex-direction: column; gap: 16px;">
          <p style="color: #94a3b8;">Loading settings...</p>
        </div>
      </div>
    `,
    "About AOS": `
      <div style="padding: 20px;">
        <h2><i class="fa-solid fa-user-astronaut"></i> About AOS</h2>
        <p style="margin: 16px 0; line-height: 1.8;">Welcome to the <strong>Amuzu Operating System</strong> - a creative portfolio experience that reimagines how you explore my work.</p>
        <p style="margin: 16px 0; line-height: 1.8;">Built with modern web technologies and designed to showcase technical capabilities in an interactive, engaging format. Every window, every interaction demonstrates attention to detail and user experience.</p>
        <p style="margin: 16px 0; line-height: 1.8;">Feel free to explore, click around, and discover what I can bring to your next project.</p>
      </div>
    `,
    Terminal: `
      <div style="height: 100%; display: flex; flex-direction: column; font-family: 'Consolas', 'Courier New', monospace; background: #000; color: #c0c0c0; border-radius: 0; overflow: hidden;">
        <div style="background: #000080; color: white; padding: 2px 8px; font-size: 12px; border-bottom: 1px solid #808080;">
          <span>Command Prompt - AOS Portfolio Terminal</span>
          <span style="float: right;">─ □ ×</span>
        </div>
        <div class="terminal-output" style="flex: 1; overflow-y: auto; padding: 8px; background: #000; color: #c0c0c0; font-size: 14px; line-height: 1.2;">
          <div style="color: #00ff00;">Microsoft Windows [Version 10.0.19045.3570]</div>
          <div style="color: #00ff00;">(c) Microsoft Corporation. All rights reserved.</div>
          <div style="color: #c0c0c0;"></div>
          <div style="color: #00ff00;">C:\\Users\\Stephen&gt;</div>
        </div>
        <div style="padding: 4px 8px; background: #000; border-top: 1px solid #333; display: flex; align-items: center;">
          <span style="color: #00ff00; margin-right: 8px;">C:\\Users\\Stephen&gt;</span>
          <input type="text" id="terminal-input" placeholder="" style="flex: 1; background: transparent; border: none; color: #c0c0c0; outline: none; font-family: inherit; font-size: 14px; caret-color: #c0c0c0;">
        </div>
      </div>
    `,
    Database: `
      <div style="padding: 20px; height: 100%; display: flex; flex-direction: column;">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
          <i class="fa-solid fa-database" style="font-size: 24px; color: #ff6b35;"></i>
          <h2 id="db-title" style="margin: 0; cursor: pointer;" onclick="handleSecretKnock()">Supabase Database Manager</h2>
        </div>
        
        <!-- Admin Panel (hidden by default) -->
        <div id="admin-panel" style="display: none; background: rgba(255,0,0,0.05); border: 1px solid #ff6b35; border-radius: 12px; padding: 16px; margin-bottom: 20px; backdrop-filter: blur(16px);">
          <h3 style="color: #ff6b35; margin-bottom: 12px;"><i class="fa-solid fa-lock" style="margin-right: 8px;"></i>Admin Panel</h3>
          <div style="display: flex; gap: 12px; margin-bottom: 12px;">
            <button onclick="showAddProjectModal()" style="padding: 8px 16px; border-radius: 8px; background: #ff6b35; border: none; color: white; cursor: pointer;">
              <i class="fa-solid fa-plus" style="margin-right: 8px;"></i>Add Project
            </button>
            <button onclick="showAddUpdateModal()" style="padding: 8px 16px; border-radius: 8px; background: #ff6b35; border: none; color: white; cursor: pointer;">
              <i class="fa-solid fa-plus" style="margin-right: 8px;"></i>Add Update
            </button>
          </div>
        </div>
        
        <div style="display: flex; gap: 20px; flex: 1;">
          <!-- Collections Sidebar -->
          <div style="width: 250px; background: rgba(255,255,255,0.03); border-radius: 12px; padding: 16px; backdrop-filter: blur(16px);">
            <h3 style="margin-bottom: 12px; color: #38bdf8;">Collections</h3>
            <div id="collections-list" style="display: flex; flex-direction: column; gap: 8px;">
              <div style="padding: 8px 12px; border-radius: 8px; background: rgba(255,255,255,0.05); cursor: pointer; backdrop-filter: blur(12px);" onclick="loadCollection('users')">
                <i class="fa-solid fa-users" style="margin-right: 8px;"></i>users
              </div>
              <div style="padding: 8px 12px; border-radius: 8px; background: rgba(255,255,255,0.05); cursor: pointer; backdrop-filter: blur(12px);" onclick="loadCollection('projects')">
                <i class="fa-solid fa-diagram-project" style="margin-right: 8px;"></i>projects
              </div>
              <div style="padding: 8px 12px; border-radius: 8px; background: rgba(255,255,255,0.05); cursor: pointer; backdrop-filter: blur(12px);" onclick="loadCollection('updates')">
                <i class="fa-solid fa-bell" style="margin-right: 8px;"></i>updates
              </div>
              <div style="padding: 8px 12px; border-radius: 8px; background: rgba(255,255,255,0.05); cursor: pointer; backdrop-filter: blur(12px);" onclick="loadCollection('all_files')">
                <i class="fa-solid fa-folder-open" style="margin-right: 8px;"></i>All Files
              </div>
              <div style="padding: 8px 12px; border-radius: 8px; background: rgba(255,255,255,0.05); cursor: pointer; backdrop-filter: blur(12px);" onclick="loadCollection('user_pictures')">
                <i class="fa-regular fa-image" style="margin-right: 8px;"></i>pictures
              </div>
              <div style="padding: 8px 12px; border-radius: 8px; background: rgba(255,255,255,0.05); cursor: pointer; backdrop-filter: blur(12px);" onclick="loadCollection('user_music')">
                <i class="fa-solid fa-music" style="margin-right: 8px;"></i>music
              </div>
              <div style="padding: 8px 12px; border-radius: 8px; background: rgba(255,255,255,0.05); cursor: pointer; backdrop-filter: blur(12px);" onclick="loadCollection('user_videos')">
                <i class="fa-solid fa-film" style="margin-right: 8px;"></i>videos
              </div>
              <div style="padding: 8px 12px; border-radius: 8px; background: rgba(255,255,255,0.05); cursor: pointer; backdrop-filter: blur(12px);" onclick="loadCollection('user_documents')">
                <i class="fa-regular fa-file-lines" style="margin-right: 8px;"></i>documents
              </div>
            </div>
          </div>
          
          <!-- Documents View -->
          <div style="flex: 1; background: rgba(255,255,255,0.03); border-radius: 12px; padding: 16px; backdrop-filter: blur(16px);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
              <h3 id="current-collection-title" style="margin: 0;">Select a collection</h3>
              <button onclick="refreshDatabase()" style="padding: 8px 16px; border-radius: 8px; background: #38bdf8; border: none; color: white; cursor: pointer;">
                <i class="fa-solid fa-refresh" style="margin-right: 8px;"></i>Refresh
              </button>
            </div>
            <div id="documents-container" style="overflow-y: auto; max-height: 400px;">
              <p style="color: #94a3b8; text-align: center; margin: 40px 0;">Select a collection to view documents</p>
            </div>
          </div>
        </div>
      </div>
    `,
    Browser: `
      <div style="padding: 0; height: 100%; display: flex; flex-direction: column;">
        <div style="padding: 12px 16px; background: rgba(255,255,255,0.05); border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; gap: 8px;">
          <button id="browser-back" style="padding: 6px 10px; border-radius: 6px; background: rgba(255,255,255,0.1); border: none; color: #e2e8f0; cursor: pointer;"><i class="fa-solid fa-arrow-left"></i></button>
          <button id="browser-forward" style="padding: 6px 10px; border-radius: 6px; background: rgba(255,255,255,0.1); border: none; color: #e2e8f0; cursor: pointer;"><i class="fa-solid fa-arrow-right"></i></button>
          <button id="browser-refresh" style="padding: 6px 10px; border-radius: 6px; background: rgba(255,255,255,0.1); border: none; color: #e2e8f0; cursor: pointer;"><i class="fa-solid fa-rotate"></i></button>
          <input id="browser-url" type="text" value="https://stephenj.vercel.app" style="flex: 1; padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); color: #e2e8f0;">
          <button id="browser-go" style="padding: 6px 12px; border-radius: 6px; background: #38bdf8; border: none; color: white; cursor: pointer; font-weight: 500;">Go</button>
        </div>
        <div style="flex: 1; overflow: hidden;">
          <iframe id="browser-frame" src="https://stephenj.vercel.app" style="width: 100%; height: 100%; border: none; background: white;"></iframe>
        </div>
      </div>
    `,
    Calculator: `
      <div style="padding: 20px; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center;">
        <div style="background: rgba(255,255,255,0.05); border-radius: 20px; padding: 24px; backdrop-filter: blur(16px); max-width: 300px;">
          <div style="display: flex; justify-content: flex-end; margin-bottom: 16px;">
            <div id="calc-display" style="background: rgba(0,0,0,0.3); border-radius: 12px; padding: 16px; min-height: 60px; display: flex; align-items: center; justify-content: flex-end; font-size: 24px; color: #e2e8f0;">0</div>
          </div>
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;">
            <button class="calc-btn" data-value="C" style="grid-column: span 2;">C</button>
            <button class="calc-btn" data-value="←">←</button>
            <button class="calc-btn operator" data-value="/">/</button>
            <button class="calc-btn" data-value="7">7</button>
            <button class="calc-btn" data-value="8">8</button>
            <button class="calc-btn" data-value="9">9</button>
            <button class="calc-btn operator" data-value="*">*</button>
            <button class="calc-btn" data-value="4">4</button>
            <button class="calc-btn" data-value="5">5</button>
            <button class="calc-btn" data-value="6">6</button>
            <button class="calc-btn operator" data-value="-">-</button>
            <button class="calc-btn" data-value="1">1</button>
            <button class="calc-btn" data-value="2">2</button>
            <button class="calc-btn" data-value="3">3</button>
            <button class="calc-btn operator" data-value="+">+</button>
            <button class="calc-btn" data-value="0" style="grid-column: span 2;">0</button>
            <button class="calc-btn" data-value=".">.</button>
            <button class="calc-btn equals" data-value="=">=</button>
          </div>
        </div>
      </div>
    `,
    Calendar: `
      <div style="padding: 20px; height: 100%; display: flex; flex-direction: column;">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
          <i class="fa-regular fa-calendar" style="font-size: 24px; color: #ff9800;"></i>
          <h2 style="margin: 0;">Calendar</h2>
        </div>
        <div style="flex: 1; background: rgba(255,255,255,0.03); border-radius: 12px; padding: 16px; backdrop-filter: blur(16px);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <button style="padding: 4px 8px; border-radius: 4px; background: rgba(255,255,255,0.1); border: none; color: #e2e8f0; cursor: pointer;"><i class="fa-solid fa-chevron-left"></i></button>
            <h3 style="margin: 0; color: #e2e8f0;">December 2025</h3>
            <button style="padding: 4px 8px; border-radius: 4px; background: rgba(255,255,255,0.1); border: none; color: #e2e8f0; cursor: pointer;"><i class="fa-solid fa-chevron-right"></i></button>
          </div>
          <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px;">
            <div style="padding: 8px; text-align: center; color: #94a3b8; font-size: 12px;">Sun</div>
            <div style="padding: 8px; text-align: center; color: #94a3b8; font-size: 12px;">Mon</div>
            <div style="padding: 8px; text-align: center; color: #94a3b8; font-size: 12px;">Tue</div>
            <div style="padding: 8px; text-align: center; color: #94a3b8; font-size: 12px;">Wed</div>
            <div style="padding: 8px; text-align: center; color: #94a3b8; font-size: 12px;">Thu</div>
            <div style="padding: 8px; text-align: center; color: #94a3b8; font-size: 12px;">Fri</div>
            <div style="padding: 8px; text-align: center; color: #94a3b8; font-size: 12px;">Sat</div>
            ${Array.from(
              { length: 31 },
              (_, i) =>
                `<div style="padding: 8px; text-align: center; color: #e2e8f0; cursor: pointer; border-radius: 4px; ${
                  i + 1 === 6
                    ? "background: rgba(56,189,248,0.2);"
                    : "hover:background: rgba(255,255,255,0.1);"
                }">${i + 1}</div>`
            ).join("")}
          </div>
        </div>
      </div>
    `,
    Mail: `
      <div style="padding: 20px; height: 100%; display: flex; flex-direction: column;">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
          <i class="fa-regular fa-envelope" style="font-size: 24px; color: #3f51b5;"></i>
          <h2 style="margin: 0;">Mail</h2>
        </div>
        <div style="flex: 1; background: rgba(255,255,255,0.03); border-radius: 12px; padding: 16px; backdrop-filter: blur(16px); display: flex;">
          <div style="width: 250px; border-right: 1px solid rgba(255,255,255,0.1); padding-right: 16px;">
            <button id="compose-email-btn" style="width: 100%; padding: 10px; border-radius: 8px; background: #3f51b5; border: none; color: white; cursor: pointer; margin-bottom: 16px; font-weight: 500;">
              <i class="fa-solid fa-pen" style="margin-right: 8px;"></i>Compose
            </button>
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <div style="padding: 8px; border-radius: 4px; background: rgba(63,81,181,0.2); color: #e2e8f0; cursor: pointer;">
                <i class="fa-solid fa-inbox" style="margin-right: 8px;"></i>Inbox
              </div>
              <div style="padding: 8px; border-radius: 4px; color: #94a3b8; cursor: pointer;">
                <i class="fa-solid fa-paper-plane" style="margin-right: 8px;"></i>Sent
              </div>
              <div style="padding: 8px; border-radius: 4px; color: #94a3b8; cursor: pointer;">
                <i class="fa-solid fa-file" style="margin-right: 8px;"></i>Drafts
              </div>
            </div>
          </div>
          <div id="mail-content" style="flex: 1; padding-left: 16px;">
            <div style="border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 12px; margin-bottom: 16px;">
              <h3 style="margin: 0; color: #e2e8f0;">Welcome to AOS Mail</h3>
              <p style="margin: 4px 0 0 0; color: #94a3b8; font-size: 14px;">stevejupiter4@gmail.com</p>
            </div>
            <div style="text-align: center; padding: 40px;">
              <i class="fa-regular fa-envelope-open" style="font-size: 48px; color: #94a3b8; margin-bottom: 16px;"></i>
              <p style="color: #94a3b8;">Select "Compose" to send an email to Stephen.</p>
            </div>
          </div>
        </div>
      </div>
    `,
    Messages: `
      <div style="padding: 20px; height: 100%; display: flex; flex-direction: column;">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
          <i class="fa-regular fa-comments" style="font-size: 24px; color: #e91e63;"></i>
          <h2 style="margin: 0;">Messages</h2>
          <button id="find-friends-btn" style="margin-left: auto; padding: 8px 14px; border-radius: 8px; background: #e91e63; border: none; color: white; cursor: pointer;">
            <i class="fa-solid fa-user-plus"></i> Find Friends
          </button>
        </div>
        <div style="flex: 1; background: rgba(255,255,255,0.03); border-radius: 12px; padding: 16px; backdrop-filter: blur(16px); display: flex;">
          <div style="width: 280px; border-right: 1px solid rgba(255,255,255,0.1); padding-right: 16px; display: flex; flex-direction: column;">
            <input id="friend-search-input" type="text" placeholder="Search friends..." style="padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); color: #e2e8f0; margin-bottom: 12px;">
            <div id="friends-list" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;">
              <p style="color: #94a3b8; text-align: center; margin-top: 20px;">Loading friends...</p>
            </div>
          </div>
          <div style="flex: 1; padding-left: 16px; display: flex; flex-direction: column;">
            <div id="chat-header" style="padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 12px; display: none;">
              <h3 style="margin: 0; color: #e2e8f0;" id="chat-friend-name">Select a friend</h3>
            </div>
            <div id="messages-container" style="flex: 1; overflow-y: auto; overflow-x: hidden; margin-bottom: 16px; padding: 16px; display: flex; flex-direction: column; scroll-behavior: smooth;">
              <div style="text-align: center; margin: auto;">
                <i class="fa-regular fa-comments" style="font-size: 48px; color: #94a3b8; margin-bottom: 16px;"></i>
                <p style="color: #94a3b8;">Select a friend to start chatting</p>
              </div>
            </div>
            <div id="message-input-area" style="display: none; gap: 8px;">
              <input id="message-input" type="text" placeholder="Type a message..." style="flex: 1; padding: 8px 12px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); color: #e2e8f0;">
              <button id="send-message-btn" style="padding: 8px 12px; border-radius: 20px; background: #e91e63; border: none; color: white; cursor: pointer;">
                <i class="fa-solid fa-paper-plane"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
      <div id="find-friends-modal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 1000; align-items: center; justify-content: center;">
        <div style="background: rgba(15,23,42,0.95); border: 1px solid rgba(255,255,255,0.2); border-radius: 20px; padding: 24px; max-width: 500px; width: 90%; backdrop-filter: blur(20px);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <h3 style="margin: 0; color: #e2e8f0;">Find Friends</h3>
            <button id="close-find-friends" style="padding: 4px 8px; border-radius: 8px; background: transparent; border: 1px solid rgba(255,255,255,0.2); color: #e2e8f0; cursor: pointer;">
              <i class="fa-solid fa-times"></i>
            </button>
          </div>
          <input id="search-users-input" type="text" placeholder="Search by name or email..." style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); color: #e2e8f0; margin-bottom: 16px;">
          <div id="search-results" style="max-height: 300px; overflow-y: auto;">
            <p style="color: #94a3b8; text-align: center;">Search for users to add as friends</p>
          </div>
        </div>
      </div>
    `,
    "AOS AI": `
      <div style="height: 100%; display: flex; flex-direction: column;">
        <div style="flex: 1; overflow-y: auto; padding: 16px 20px; min-height: 0; scroll-behavior: smooth; -webkit-overflow-scrolling: touch; scrollbar-width: thin; scrollbar-color: rgba(16, 185, 129, 0.3) transparent;">
          <div id="ai-chat-container">
            <div class="ai-response">
              <div class="ai-response-header">
                <i class="fa-solid fa-robot"></i>
                <strong>AOS AI</strong>
              </div>
              <div class="ai-response-body">
                <p>Hello! I'm AOS AI, your intelligent assistant with comprehensive knowledge about Stephen J. Amuzu. I can help you learn about his skills, experience, projects, and background. What would you like to know?</p>
              </div>
            </div>
          </div>
        </div>
        <div style="padding: 12px 20px; border-top: 1px solid rgba(255,255,255,0.1); background: rgba(15,23,42,0.8); backdrop-filter: blur(16px);">
          <div style="display: flex; gap: 8px; margin-bottom: 8px;">
            <input id="ai-input" type="text" placeholder="Ask me anything about Stephen J. Amuzu..." style="flex: 1; padding: 10px 14px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); color: #e2e8f0;">
            <button id="send-ai-message" style="padding: 10px 16px; border-radius: 12px; background: #10b981; border: none; color: white; cursor: pointer; font-weight: 500;">
              <i class="fa-solid fa-paper-plane"></i> Send
            </button>
          </div>
          <div style="padding: 8px 12px; border-radius: 8px; background: rgba(59,130,246,0.1); border: 1px solid rgba(59,130,246,0.3);">
            <p style="margin: 0; font-size: 12px; color: #94a3b8;">
              <i class="fa-solid fa-info-circle" style="color: #3b82f6;"></i>
              Powered by HuggingFace • Conversation memory enabled
            </p>
          </div>
        </div>
      </div>
    `,
    "Gift Creator": `
      <div style="padding: 20px; height: 100%; display: flex; flex-direction: column; overflow-y: auto;">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
          <i class="fa-solid fa-gift" style="font-size: 24px; color: #f59e0b;"></i>
          <h2 style="margin: 0;">Gift Creator</h2>
        </div>

        <!-- Received Gifts Section -->
        <div id="received-gifts-section" style="display: none; margin-bottom: 20px;">
          <div style="background: rgba(255,255,255,0.03); border-radius: 12px; padding: 20px; backdrop-filter: blur(16px);">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
              <i class="fa-solid fa-inbox" style="font-size: 20px; color: #10b981;"></i>
              <h3 style="margin: 0; color: #e2e8f0;">Your Received Gifts</h3>
            </div>
            <div id="received-gifts-list" style="display: flex; flex-direction: column; gap: 12px;">
              <!-- Gifts will be loaded here -->
            </div>
          </div>
        </div>

        <div style="flex: 1; background: rgba(255,255,255,0.03); border-radius: 12px; padding: 20px; backdrop-filter: blur(16px);">
          <form id="gift-creator-form" style="display: flex; flex-direction: column; gap: 16px;">
            <div style="padding: 12px; border-radius: 8px; background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.3); margin-bottom: 8px;">
              <p style="margin: 0; color: #10b981; font-weight: 500;"><i class="fa-solid fa-info-circle"></i> Sending gift to: Stephen J. Amuzu</p>
              <p style="margin: 4px 0 0 0; color: #94a3b8; font-size: 14px;">stevejupiter4@gmail.com</p>
            </div>
            <div>
              <label style="display: block; margin-bottom: 8px; color: #e2e8f0; font-weight: 500;">Your Name</label>
              <input type="text" id="gift-sender-name" required readonly style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.5); color: #94a3b8;">
            </div>
            <div>
              <label style="display: block; margin-bottom: 8px; color: #e2e8f0; font-weight: 500;">Your Email</label>
              <input type="email" id="gift-sender-email" required readonly style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.5); color: #94a3b8;">
            </div>
            <div>
              <label style="display: block; margin-bottom: 8px; color: #e2e8f0; font-weight: 500;">Gift Type</label>
              <select id="gift-type" required style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: #e2e8f0;">
                <option value="">Select gift type</option>
                <option value="birthday">Birthday Gift</option>
                <option value="anniversary">Anniversary Gift</option>
                <option value="thank-you">Thank You Gift</option>
                <option value="congratulations">Congratulations Gift</option>
                <option value="just-because">Just Because</option>
              </select>
            </div>
            <div>
              <label style="display: block; margin-bottom: 8px; color: #e2e8f0; font-weight: 500;">Amount (GHS)</label>
              <input type="number" id="gift-amount" min="1" step="0.01" required style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: #e2e8f0;">
            </div>
            <div>
              <label style="display: block; margin-bottom: 8px; color: #e2e8f0; font-weight: 500;">Message (Optional)</label>
              <textarea id="gift-message" rows="4" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: #e2e8f0; resize: vertical;"></textarea>
            </div>
            <button type="submit" style="padding: 12px; border-radius: 8px; background: #f59e0b; border: none; color: white; cursor: pointer; font-weight: 600; font-size: 16px;">
              <i class="fa-solid fa-credit-card" style="margin-right: 8px;"></i>Proceed to Payment
            </button>
          </form>
          <div id="gift-status" style="margin-top: 16px;"></div>
        </div>
      </div>
    `,
    Pictures: `
      <div style="padding: 20px; height: 100%; display: flex; flex-direction: column;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
          <div>
            <h2 style="margin: 0; display: flex; align-items: center; gap: 8px;">
              <i class="fa-regular fa-image"></i>
              Pictures
            </h2>
            <p style="margin: 6px 0 0 0; color: #94a3b8;">View and upload your images.</p>
          </div>
          <div style="display: flex; gap: 8px;">
            <input type="file" id="picture-upload" accept="image/*" multiple style="display: none;">
            <button id="upload-picture-btn" style="padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(148,163,184,0.4); background: rgba(56,189,248,0.15); color: #38bdf8; cursor: pointer;">
              <i class="fa-solid fa-upload"></i>
              Upload
            </button>
            <button id="refresh-pictures-btn" style="padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(148,163,184,0.4); background: rgba(148,163,184,0.1); color: #e2e8f0; cursor: pointer;">
              <i class="fa-solid fa-rotate"></i>
              Refresh
            </button>
          </div>
        </div>
        <div id="pictures-grid" style="margin-top: 24px; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 16px; overflow-y: auto;">
          <p style="color: #94a3b8; grid-column: 1 / -1;">Loading pictures...</p>
        </div>
      </div>
    `,
    Music: `
      <div style="padding: 20px; height: 100%; display: flex; flex-direction: column;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
          <div>
            <h2 style="margin: 0; display: flex; align-items: center; gap: 8px;">
              <i class="fa-solid fa-music"></i>
              Music
            </h2>
            <p style="margin: 6px 0 0 0; color: #94a3b8;">Listen to your audio files.</p>
          </div>
          <div style="display: flex; gap: 8px;">
            <input type="file" id="music-upload" accept="audio/*" multiple style="display: none;">
            <button id="upload-music-btn" style="padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(148,163,184,0.4); background: rgba(56,189,248,0.15); color: #38bdf8; cursor: pointer;">
              <i class="fa-solid fa-upload"></i>
              Upload
            </button>
            <button id="refresh-music-btn" style="padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(148,163,184,0.4); background: rgba(148,163,184,0.1); color: #e2e8f0; cursor: pointer;">
              <i class="fa-solid fa-rotate"></i>
              Refresh
            </button>
          </div>
        </div>
        <div id="music-list" style="margin-top: 24px; display: flex; flex-direction: column; gap: 12px; overflow-y: auto;">
          <p style="color: #94a3b8;">Loading music...</p>
        </div>
      </div>
    `,
    Videos: `
      <div style="padding: 20px; height: 100%; display: flex; flex-direction: column;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
          <div>
            <h2 style="margin: 0; display: flex; align-items: center; gap: 8px;">
              <i class="fa-solid fa-film"></i>
              Videos
            </h2>
            <p style="margin: 6px 0 0 0; color: #94a3b8;">Watch your video files.</p>
          </div>
          <div style="display: flex; gap: 8px;">
            <input type="file" id="video-upload" accept="video/*" multiple style="display: none;">
            <button id="upload-video-btn" style="padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(148,163,184,0.4); background: rgba(56,189,248,0.15); color: #38bdf8; cursor: pointer;">
              <i class="fa-solid fa-upload"></i>
              Upload
            </button>
            <button id="refresh-videos-btn" style="padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(148,163,184,0.4); background: rgba(148,163,184,0.1); color: #e2e8f0; cursor: pointer;">
              <i class="fa-solid fa-rotate"></i>
              Refresh
            </button>
          </div>
        </div>
        <div id="videos-grid" style="margin-top: 24px; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; overflow-y: auto;">
          <p style="color: #94a3b8; grid-column: 1 / -1;">Loading videos...</p>
        </div>
      </div>
    `,
    Documents: `
      <div style="padding: 20px; height: 100%; display: flex; flex-direction: column;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
          <div>
            <h2 style="margin: 0; display: flex; align-items: center; gap: 8px;">
              <i class="fa-regular fa-file-lines"></i>
              Documents
            </h2>
            <p style="margin: 6px 0 0 0; color: #94a3b8;">Access your document files.</p>
          </div>
          <div style="display: flex; gap: 8px;">
            <input type="file" id="document-upload" accept=".pdf,.doc,.docx,.txt,.rtf" multiple style="display: none;">
            <button id="upload-document-btn" style="padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(148,163,184,0.4); background: rgba(56,189,248,0.15); color: #38bdf8; cursor: pointer;">
              <i class="fa-solid fa-upload"></i>
              Upload
            </button>
            <button id="refresh-documents-btn" style="padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(148,163,184,0.4); background: rgba(148,163,184,0.1); color: #e2e8f0; cursor: pointer;">
              <i class="fa-solid fa-rotate"></i>
              Refresh
            </button>
          </div>
        </div>
        <div id="documents-list" style="margin-top: 24px; display: flex; flex-direction: column; gap: 12px; overflow-y: auto;">
          <p style="color: #94a3b8;">Loading documents...</p>
        </div>
      </div>
    `,
  };

  return (
    portfolioContent[title] ||
    `
    <h2>${title}</h2>
    <p>This is the ${title} window. Content would be displayed here.</p>
  `
  );
}

async function loadProjectsFromFirebase() {
  const grid = document.getElementById("projects-grid");
  if (!grid) return;

  if (!window.firebaseDb) {
    grid.innerHTML = `<p style="color: #ef4444;">Firebase database not available.</p>`;
    return;
  }

  grid.innerHTML = `<p style="color: #94a3b8;">Fetching projects...</p>`;

  try {
    const projectsRef = collection(window.firebaseDb, "projects");
    const q = query(projectsRef, orderBy("createdAt", "desc"));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      grid.innerHTML = `<p style="color: #94a3b8;">No projects yet. Add one from the admin panel.</p>`;
      return;
    }

    const cards = snapshot.docs
      .map((docSnap) => {
        const data = docSnap.data();
        const image = data.imageUrl || "assets/AOS.jpg";
        const techList = Array.isArray(data.technology) ? data.technology : [];
        const techBadges =
          techList.length > 0
            ? techList
                .map(
                  (tech) =>
                    `<span style="padding: 4px 10px; border-radius: 999px; background: rgba(255,255,255,0.06); font-size: 12px;">${tech}</span>`
                )
                .join(" ")
            : `<span style="color: #94a3b8; font-size: 12px;">Tech stack coming soon</span>`;
        const createdAt = data.createdAt?.toDate
          ? data.createdAt.toDate().toLocaleDateString()
          : "Recently";
        const githubButton = data.github
          ? `<button style="padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); color: #e2e8f0; cursor: pointer;" onclick="window.open('${data.github}', '_blank')">
                <i class="fa-brands fa-github"></i>
                View GitHub
             </button>`
          : "";
        const liveButton = data.projectUrl
          ? `<button style="padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(16,185,129,0.5); background: rgba(16,185,129,0.15); color: #6ee7b7; cursor: pointer;" onclick="window.open('${data.projectUrl}', '_blank')">
              <i class="fa-solid fa-link"></i>
              Open Project
            </button>`
          : "";
        const downloadButton = data.downloadLink
          ? `<button style="padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(249,115,22,0.4); background: rgba(249,115,22,0.15); color: #fdba74; cursor: pointer;" onclick="window.open('${data.downloadLink}', '_blank')">
              <i class="fa-solid fa-download"></i>
              Download
            </button>`
          : "";

        return `
          <article style="display: grid; grid-template-columns: 140px 1fr; gap: 16px; padding: 16px; border-radius: 16px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); backdrop-filter: blur(18px);">
            <div style="width: 100%; height: 120px; border-radius: 12px; overflow: hidden; background: rgba(15,23,42,0.7); display: flex; align-items: center; justify-content: center;">
              <img src="${image}" alt="${
          data.title || "Project"
        }" style="width: 100%; height: 100%; object-fit: cover;" />
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px;">
                <h3 style="margin: 0; font-size: 18px;">${
                  data.title || "Untitled Project"
                }</h3>
                <span style="color: #94a3b8; font-size: 12px;">${createdAt}</span>
              </div>
              <p style="margin: 0; color: #cbd5f5; line-height: 1.5;">
                ${data.description || "Description coming soon."}
              </p>
              <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                ${techBadges}
              </div>
              <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                ${liveButton}
                ${githubButton}
                ${downloadButton}
                <button style="padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(59,130,246,0.4); background: rgba(37,99,235,0.2); color: #bfdbfe; cursor: pointer;" onclick="navigator.clipboard?.writeText('${
                  data.imageDownloadUrl || data.imageUrl || ""
                }')">
                  <i class="fa-solid fa-image"></i>
                  Copy Image URL
                </button>
              </div>
            </div>
          </article>
        `;
      })
      .join("");

    grid.innerHTML = cards;
  } catch (error) {
    console.error("Error loading projects:", error);
    grid.innerHTML = `<p style="color: #ef4444;">Failed to load projects: ${error.message}</p>`;
  }
}

function getFileManagerCollections() {
  let collections;
  if (
    Array.isArray(window.FILE_MANAGER_COLLECTIONS) &&
    window.FILE_MANAGER_COLLECTIONS.length > 0
  ) {
    collections = window.FILE_MANAGER_COLLECTIONS;
  } else {
    collections = FILE_MANAGER_COLLECTIONS;
  }

  // Only show 'users' collection if signed in as stevejupiter4@gmail.com
  if (currentUser?.email !== "stevejupiter4@gmail.com") {
    collections = collections.filter((col) => col !== "users");
  }

  return collections;
}

async function initFileManager() {
  const tree = document.getElementById("file-tree");
  const preview = document.getElementById("file-preview");

  if (!tree) return;

  const refreshBtn = document.getElementById("file-manager-refresh");
  if (refreshBtn && !refreshBtn.dataset.bound) {
    refreshBtn.addEventListener("click", () => initFileManager());
    refreshBtn.dataset.bound = "true";
  }

  if (!window.firebaseDb) {
    tree.innerHTML = `<p style="color: #ef4444;">Sign in to Firebase to view your files.</p>`;
    if (preview)
      preview.innerHTML = `<p style="color: #94a3b8;">Authentication is required to browse documents.</p>`;
    return;
  }

  tree.innerHTML = `<p style="color: #94a3b8;">Loading Firestore collections...</p>`;
  if (preview)
    preview.innerHTML = `<p style="color: #94a3b8;">Select a document from the left pane.</p>`;

  const collectionNames = getFileManagerCollections();
  if (!collectionNames.length) {
    tree.innerHTML = `<p style="color: #94a3b8;">No collections configured for the file manager.</p>`;
    return;
  }

  const branches = [];
  for (const name of collectionNames) {
    try {
      const colRef = collection(window.firebaseDb, name);
      const snapshot = await getDocs(colRef);
      const docs = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        data: docSnap.data(),
      }));

      fileManagerCache[name] = docs.reduce((acc, doc) => {
        acc[doc.id] = doc.data;
        return acc;
      }, {});

      branches.push({ name, docs });
    } catch (error) {
      console.error(`Error loading collection ${name}:`, error);
      branches.push({ name, docs: [], error });
    }
  }

  const treeHtml = branches
    .map(({ name, docs, error }) => {
      if (error) {
        return `
          <div style="margin-bottom: 16px;">
            <div style="display: flex; align-items: center; gap: 8px; color: #ef4444;">
              <i class="fa-solid fa-triangle-exclamation"></i>
              <strong>${escapeHtml(name)}</strong>
            </div>
            <p style="margin: 4px 0 0 0; color: #ef4444; font-size: 13px;">${escapeHtml(
              error.message
            )}</p>
          </div>
        `;
      }

      const docItems = docs.length
        ? docs
            .map((doc) => {
              const label = doc.data.title || doc.id;
              const referenceDate =
                typeof doc.data.updatedAt?.toDate === "function"
                  ? doc.data.updatedAt.toDate()
                  : typeof doc.data.createdAt?.toDate === "function"
                  ? doc.data.createdAt.toDate()
                  : null;
              const subtitle = referenceDate
                ? referenceDate.toLocaleDateString()
                : "";
              return `
                <button type="button" class="file-node-btn" data-collection="${escapeHtml(
                  name
                )}" data-doc-id="${escapeHtml(
                doc.id
              )}" style="width: 100%; text-align: left; display: flex; flex-direction: column; gap: 2px; padding: 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); background: rgba(255,255,255,0.02); color: #e2e8f0;">
                  <span style="font-size: 14px;">${escapeHtml(label)}</span>
                  <small style="color: #94a3b8;">${escapeHtml(subtitle)}</small>
                </button>
              `;
            })
            .join("")
        : `<p style="color: #94a3b8; font-size: 13px;">No documents yet.</p>`;

      return `
        <details open style="margin-bottom: 12px;">
          <summary style="cursor: pointer; display: flex; align-items: center; gap: 8px; color: #e2e8f0;">
            <i class="fa-solid fa-folder"></i>
            <span>${escapeHtml(name)}</span>
            <span style="color: #94a3b8; font-size: 12px;">(${
              docs.length
            })</span>
          </summary>
          <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 6px;">
            ${docItems}
          </div>
        </details>
      `;
    })
    .join("");

  tree.innerHTML = treeHtml;
  tree.onclick = (event) => {
    const btn = event.target.closest(".file-node-btn");
    if (!btn) return;
    previewFirestoreFile(btn.dataset.collection, btn.dataset.docId);
  };
}

function previewFirestoreFile(collectionName, docId) {
  const preview = document.getElementById("file-preview");
  if (!preview) return;

  const docData = fileManagerCache[collectionName]?.[docId];
  if (!docData) {
    preview.innerHTML = `<p style="color: #ef4444;">Document not found.</p>`;
    return;
  }

  const jsonString = (() => {
    try {
      return JSON.stringify(docData, null, 2);
    } catch (error) {
      return JSON.stringify({ error: error.message });
    }
  })();

  const rows = Object.entries(docData)
    .map(([key, value]) => {
      return `
        <div style="padding: 8px; border-radius: 8px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04);">
          <div style="font-size: 12px; color: #94a3b8;">${escapeHtml(key)}</div>
          <div style="margin-top: 4px; font-size: 14px;">${formatPreviewValue(
            value
          )}</div>
        </div>
      `;
    })
    .join("");

  preview.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
      <div>
        <h3 style="margin: 0;">${escapeHtml(docData.title || docId)}</h3>
        <p style="margin: 4px 0 0 0; color: #94a3b8; font-size: 12px;">Collection: ${escapeHtml(
          collectionName
        )}</p>
      </div>
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        <button type="button" style="padding: 6px 10px; border-radius: 6px; border: 1px solid rgba(59,130,246,0.5); background: rgba(37,99,235,0.2); color: #bfdbfe; cursor: pointer;" onclick="viewDocument('${collectionName}', '${docId}')">
          <i class="fa-regular fa-file-lines"></i>
          Open JSON
        </button>
        <button type="button" data-action="copy-json" style="padding: 6px 10px; border-radius: 6px; border: 1px solid rgba(148,163,184,0.4); background: rgba(148,163,184,0.1); color: #e2e8f0; cursor: pointer;">
          <i class="fa-solid fa-copy"></i>
          Copy JSON
        </button>
      </div>
    </div>
    <div style="margin-top: 16px; display: flex; flex-direction: column; gap: 8px;">
      ${rows}
    </div>
  `;
  const copyBtn = preview.querySelector('[data-action="copy-json"]');
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      try {
        navigator.clipboard?.writeText(jsonString);
      } catch (error) {
        console.error("Clipboard error:", error);
      }
    });
  }
}

function formatPreviewValue(value) {
  if (value === null || value === undefined) {
    return '<span style="color: #94a3b8;">(empty)</span>';
  }

  if (typeof value === "string") {
    return escapeHtml(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '<span style="color: #94a3b8;">[ ]</span>';
    }
    return value
      .map(
        (item) =>
          `<span style="padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,0.08); margin-right: 4px;">${escapeHtml(
            item?.toString?.() || String(item)
          )}</span>`
      )
      .join(" ");
  }

  if (typeof value?.toDate === "function") {
    return value.toDate().toLocaleString();
  }

  if (value instanceof Date) {
    return value.toLocaleString();
  }

  try {
    return `<pre style="white-space: pre-wrap; margin: 0;">${escapeHtml(
      JSON.stringify(value, null, 2)
    )}</pre>`;
  } catch (error) {
    return escapeHtml(String(value));
  }
}

// Lazy load wallpaper images sequentially
function lazyLoadWallpaperImages() {
  const imageWallpapers = [
    { class: "swatch-aos-image", url: "assets/AOS.jpg" },
    {
      class: "swatch-mountain",
      url: "assets/pexels-bri-schneiter-28802-346529.jpg",
    },
    { class: "swatch-forest", url: "assets/pexels-cottonbro-9695151.jpg" },
    { class: "swatch-city", url: "assets/pexels-haugenzhays-1798631.jpg" },
    { class: "swatch-ocean", url: "assets/pexels-maxfrancis-2246476.jpg" },
    {
      class: "swatch-desert",
      url: "assets/pexels-pedro-figueras-202443-681467.jpg",
    },
    {
      class: "swatch-space",
      url: "assets/pexels-quang-nguyen-vinh-222549-2166711.jpg",
    },
    { class: "swatch-abstract", url: "assets/pexels-therato-1933320.jpg" },
  ];

  let loadedCount = 0;

  function loadNextImage() {
    if (loadedCount >= imageWallpapers.length) return;

    const wallpaper = imageWallpapers[loadedCount];
    const swatch = document.querySelector(`.${wallpaper.class}`);

    if (swatch) {
      // Add loading state
      swatch.classList.add("loading");

      const img = new Image();
      img.onload = () => {
        // Remove loading state and set background
        swatch.classList.remove("loading");
        swatch.style.background = `url("${wallpaper.url}") center/cover`;
        loadedCount++;
        // Load next image after a small delay
        setTimeout(loadNextImage, 100);
      };
      img.onerror = () => {
        // Remove loading state on error
        swatch.classList.remove("loading");
        loadedCount++;
        // Continue loading next image
        setTimeout(loadNextImage, 100);
      };
      img.src = wallpaper.url;
    } else {
      loadedCount++;
      setTimeout(loadNextImage, 100);
    }
  }

  // Start loading images
  loadNextImage();
}

// Setup wallpaper picker
function setupWallpaperPicker() {
  const wallpaperModal = document.getElementById("wallpaperModal");
  const wallpaperButton = document.getElementById("wallpaperButton");
  const closeButton = document.getElementById("closeWallpaperModal");
  const wallpaperButtons = document.querySelectorAll(".wallpaper-option");
  const desktop = document.getElementById("desktop");

  // Open modal
  if (wallpaperButton) {
    wallpaperButton.addEventListener("click", (e) => {
      e.stopPropagation();
      wallpaperModal.classList.remove("hidden");
      // Lazy load wallpaper images after modal opens
      lazyLoadWallpaperImages();
    });
  }

  // Close modal
  if (closeButton) {
    closeButton.addEventListener("click", () => {
      wallpaperModal.classList.add("hidden");
    });
  }

  // Close on backdrop click
  if (wallpaperModal) {
    wallpaperModal.addEventListener("click", (e) => {
      if (e.target === wallpaperModal) {
        wallpaperModal.classList.add("hidden");
      }
    });
  }

  // Wallpaper selection
  wallpaperButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const wallpaper = btn.dataset.wallpaper;

      // Remove all wallpaper classes
      desktop.classList.remove(
        "wallpaper-aurora",
        "wallpaper-nebula",
        "wallpaper-sunset",
        "wallpaper-mono",
        "wallpaper-aos-image",
        "wallpaper-white"
      );

      // Add selected wallpaper class
      desktop.classList.add(`wallpaper-${wallpaper}`);

      // Save user preference
      userPreferences.wallpaper = wallpaper;
      saveUserPreferences();

      // Apply theme based on wallpaper
      applyUserPreferences();

      // Update active state
      wallpaperButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      // Close modal after selection
      if (wallpaperModal) {
        wallpaperModal.classList.add("hidden");
      }
    });
  });
}

// Setup start menu search
function setupStartMenuSearch() {
  const searchInput = document.getElementById("startSearch");
  if (!searchInput) return;

  searchInput.addEventListener("input", (e) => {
    const query = e.target.value.toLowerCase();
    const appItems = document.querySelectorAll(".app-item");

    appItems.forEach((item) => {
      const title = item.querySelector("span").textContent.toLowerCase();
      if (title.includes(query)) {
        item.style.display = "flex";
      } else {
        item.style.display = "none";
      }
    });
  });
}

// Setup featured cards
function setupFeaturedCards() {
  const cards = document.querySelectorAll(".featured-card");

  cards.forEach((card) => {
    card.addEventListener("click", () => {
      const feature = card.dataset.feature;

      if (feature === "about") {
        openWindow("About AOS", "fa-solid fa-user-astronaut");
      } else if (feature === "case-studies") {
        openWindow("Projects", "fa-solid fa-diagram-project");
      } else if (feature === "availability") {
        openWindow("Contact", "fa-solid fa-paper-plane");
      }

      closeStartMenu();
    });
  });
}

// Setup quick actions
function setupQuickActions() {
  const buttons = document.querySelectorAll(".quick-action-buttons button");

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;

      if (action === "open-resume") {
        openWindow("Resume", "fa-solid fa-id-card");
      } else if (action === "open-contact") {
        openWindow("Contact", "fa-solid fa-paper-plane");
      } else if (action === "open-github") {
        openWindow("GitHub", "fa-brands fa-github");
      } else if (action === "open-labs") {
        openWindow("Projects", "fa-solid fa-diagram-project");
      }

      closeStartMenu();
    });
  });
}

function setupTerminal(windowDiv) {
  const input = windowDiv.querySelector("#terminal-input");
  const output = windowDiv.querySelector(".window-content .terminal-output");

  if (!input) return;

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const command = input.value.trim();
      if (command) {
        processCommand(command, output);
        input.value = "";
      }
    }
  });

  // Focus input when clicking on terminal
  windowDiv.querySelector(".window-content").addEventListener("click", () => {
    input.focus();
  });
}

function processCommand(command, output) {
  const cmd = command.toLowerCase();
  let response = "";

  // Add the command to output
  output.innerHTML += `<div style="color: #c0c0c0;">C:\\Users\\Stephen&gt; ${command}</div>`;

  switch (cmd) {
    case "help":
      response = `Available commands:\r\n\r\nHELP          Displays help information on available commands.\r\nDIR           Displays a list of files and subdirectories in a directory.\r\nCD            Displays the name of or changes the current directory.\r\nCLS           Clears the screen.\r\nDATE          Displays or sets the date.\r\nECHO          Displays messages, or turns command echoing on or off.\r\nPROJECTS      Lists portfolio projects.\r\nSKILLS        Shows technical skills.\r\nABOUT         About this terminal.\r\n\r\nFor more information on a specific command, type HELP command-name`;
      break;
    case "dir":
      response = ` Volume in drive C has no label.\r\n Volume Serial Number is 1234-5678\r\n\r\n Directory of C:\\Users\\Stephen\r\n\r\n01/01/2025  12:00 AM    &lt;DIR&gt;          .\r\n01/01/2025  12:00 AM    &lt;DIR&gt;          ..\r\n01/01/2025  12:00 AM    &lt;DIR&gt;          Desktop\r\n01/01/2025  12:00 AM    &lt;DIR&gt;          Documents\r\n01/01/2025  12:00 AM    &lt;DIR&gt;          Downloads\r\n01/01/2025  12:00 AM    &lt;DIR&gt;          Projects\r\n               0 File(s)              0 bytes\r\n               6 Dir(s)   1,000,000,000 bytes free`;
      break;
    case "cd":
      response = "C:\\Users\\Stephen";
      break;
    case "cls":
      output.innerHTML = `<div style="color: #00ff00;">Microsoft Windows [Version 10.0.19045.3570]</div>
<div style="color: #00ff00;">(c) Microsoft Corporation. All rights reserved.</div>
<div style="color: #c0c0c0;"></div>
<div style="color: #00ff00;">C:\\Users\\Stephen&gt;</div>`;
      return;
    case "date":
      const now = new Date();
      response = `The current date is: ${now.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })}\r\nEnter the new date: (mm-dd-yy)`;
      break;
    case "about":
      response =
        "AOS Terminal v1.0 - Portfolio showcase terminal\r\nBuilt on Microsoft Windows Command Prompt interface";
      break;
    default:
      if (cmd.startsWith("echo ")) {
        response = command.substring(5);
      } else if (cmd === "projects") {
        response = `Portfolio Projects:\r\n\r\n- ExpressMart (React Native E-commerce platform)\r\n- Mystiwan E-Business (Multi-vendor marketplace)\r\n- AOS Portfolio OS (This interactive interface)\r\n\r\nType 'help' for more commands.`;
      } else if (cmd === "skills") {
        response = `Technical Skills:\r\n\r\n- JavaScript/TypeScript\r\n- React/React Native\r\n- Node.js/Express\r\n- HTML/CSS\r\n- Python\r\n- Database Design (Firebase, SQL)\r\n- UI/UX Design`;
      } else {
        response = `'${command}' is not recognized as an internal or external command,\r\noperable program or batch file.`;
      }
  }

  if (response) {
    // Split response by newlines and add each line with proper formatting
    const responseLines = response.split("\r\n");
    responseLines.forEach((line) => {
      output.innerHTML += `<div style="color: #c0c0c0;">${line}</div>`;
    });
    output.innerHTML += `<div style="color: #00ff00;">C:\\Users\\Stephen&gt;</div>`;
  } else {
    output.innerHTML += `<div style="color: #00ff00;">C:\\Users\\Stephen&gt;</div>`;
  }

  // Scroll to bottom
  output.scrollTop = output.scrollHeight;
}

// Messages App Functions
let currentChatFriend = null;
let currentChatFriendData = null;
let messagesUnsubscribe = null;

async function initMessagesApp() {
  if (!currentUser) return;

  loadFriendsList();

  const findFriendsBtn = document.getElementById("find-friends-btn");
  const findFriendsModal = document.getElementById("find-friends-modal");
  const closeFindFriends = document.getElementById("close-find-friends");
  const searchUsersInput = document.getElementById("search-users-input");
  const friendSearchInput = document.getElementById("friend-search-input");
  const messageInput = document.getElementById("message-input");
  const sendMessageBtn = document.getElementById("send-message-btn");

  if (findFriendsBtn) {
    findFriendsBtn.onclick = () => {
      findFriendsModal.style.display = "flex";
      loadAllUsers(); // Load all users when modal opens
    };
  }

  if (closeFindFriends) {
    closeFindFriends.onclick = () => {
      findFriendsModal.style.display = "none";
    };
  }

  if (searchUsersInput) {
    let searchTimeout;
    searchUsersInput.oninput = (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => searchUsers(e.target.value), 500);
    };
  }

  if (friendSearchInput) {
    friendSearchInput.oninput = (e) => {
      filterFriendsList(e.target.value);
    };
  }

  if (messageInput) {
    messageInput.onkeypress = (e) => {
      if (e.key === "Enter") sendMessage();
    };
  }

  if (sendMessageBtn) {
    sendMessageBtn.onclick = sendMessage;
  }
}

async function loadFriendsList() {
  const friendsList = document.getElementById("friends-list");
  if (!friendsList || !currentUser) return;

  try {
    const userDoc = await getDoc(
      doc(window.firebaseDb, "users", currentUser.uid)
    );
    const friends = userDoc.data()?.friends || [];

    if (friends.length === 0) {
      friendsList.innerHTML =
        '<p style="color: #94a3b8; text-align: center; margin-top: 20px;">No friends yet. Click "Find Friends" to add some!</p>';
      return;
    }

    const friendsData = await Promise.all(
      friends.map(async (friendId) => {
        const friendDoc = await getDoc(
          doc(window.firebaseDb, "users", friendId)
        );
        return { id: friendId, ...friendDoc.data() };
      })
    );

    friendsList.innerHTML = friendsData
      .map((friend) => {
        const initial = (friend.displayName || friend.email || "U")
          .charAt(0)
          .toUpperCase();
        return `
      <div class="friend-item" data-friend-id="${
        friend.id
      }" style="padding: 12px; border-radius: 8px; background: rgba(255,255,255,0.05); cursor: pointer; transition: all 0.2s;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, #e91e63, #f06292); display: flex; align-items: center; justify-content: center; color: white; font-weight: 600; overflow: hidden;">
            ${
              friend.photoURL
                ? `<img src="${friend.photoURL}" alt="${
                    friend.displayName || "User"
                  }" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.parentElement.innerHTML='${initial}'">`
                : initial
            }
          </div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 600; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${
              friend.displayName || friend.email
            }</div>
            <div style="font-size: 12px; color: #94a3b8;">Click to chat</div>
          </div>
        </div>
      </div>
    `;
      })
      .join("");

    document.querySelectorAll(".friend-item").forEach((item) => {
      item.onclick = () => openChat(item.dataset.friendId);
    });
  } catch (error) {
    console.error("Error loading friends:", error);
    friendsList.innerHTML =
      '<p style="color: #ef4444; text-align: center;">Error loading friends</p>';
  }
}

async function loadAllUsers() {
  const searchResults = document.getElementById("search-results");
  if (!searchResults || !currentUser) return;

  searchResults.innerHTML =
    '<p style="color: #94a3b8; text-align: center;">Loading users...</p>';

  try {
    const usersRef = collection(window.firebaseDb, "users");
    const snapshot = await getDocs(usersRef);

    // Get current user's friends list
    const userDoc = await getDoc(
      doc(window.firebaseDb, "users", currentUser.uid)
    );
    const currentFriends = userDoc.data()?.friends || [];

    const results = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((user) => user.id !== currentUser.uid);

    if (results.length === 0) {
      searchResults.innerHTML =
        '<p style="color: #94a3b8; text-align: center;">No other users found</p>';
      return;
    }

    searchResults.innerHTML = results
      .map((user) => {
        const isFriend = currentFriends.includes(user.id);
        const initial = (user.displayName || user.email || "U")
          .charAt(0)
          .toUpperCase();
        return `
      <div style="padding: 12px; border-radius: 8px; background: rgba(255,255,255,0.05); margin-bottom: 8px; display: flex; gap: 12px; align-items: center;">
        <div style="width: 48px; height: 48px; border-radius: 50%; background: linear-gradient(135deg, #3b82f6, #60a5fa); display: flex; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 18px; flex-shrink: 0; overflow: hidden;">
          ${
            user.photoURL
              ? `<img src="${user.photoURL}" alt="${
                  user.displayName || "User"
                }" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.parentElement.innerHTML='${initial}'">`
              : initial
          }
        </div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 600; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${
            user.displayName || "User"
          }</div>
          <div style="font-size: 12px; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${
            user.email
          }</div>
        </div>
        ${
          isFriend
            ? '<span style="padding: 6px 12px; border-radius: 8px; background: rgba(16,185,129,0.2); border: 1px solid #10b981; color: #10b981; font-size: 12px;"><i class="fa-solid fa-check"></i> Friends</span>'
            : `<button onclick="addFriend('${user.id}')" style="padding: 6px 12px; border-radius: 8px; background: #10b981; border: none; color: white; cursor: pointer; font-size: 12px;">
            <i class="fa-solid fa-user-plus"></i> Add
          </button>`
        }
      </div>
    `;
      })
      .join("");
  } catch (error) {
    console.error("Error loading users:", error);
    searchResults.innerHTML =
      '<p style="color: #ef4444; text-align: center;">Error loading users</p>';
  }
}

async function searchUsers(query) {
  const searchResults = document.getElementById("search-results");
  if (!searchResults || !query.trim()) {
    loadAllUsers(); // Load all users if search is empty
    return;
  }

  try {
    const usersRef = collection(window.firebaseDb, "users");
    const snapshot = await getDocs(usersRef);

    // Get current user's friends list
    const userDoc = await getDoc(
      doc(window.firebaseDb, "users", currentUser.uid)
    );
    const currentFriends = userDoc.data()?.friends || [];

    const results = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter(
        (user) =>
          user.id !== currentUser.uid &&
          (user.displayName?.toLowerCase().includes(query.toLowerCase()) ||
            user.email?.toLowerCase().includes(query.toLowerCase()))
      );

    if (results.length === 0) {
      searchResults.innerHTML =
        '<p style="color: #94a3b8; text-align: center;">No users found</p>';
      return;
    }

    searchResults.innerHTML = results
      .map((user) => {
        const isFriend = currentFriends.includes(user.id);
        const initial = (user.displayName || user.email || "U")
          .charAt(0)
          .toUpperCase();
        return `
      <div style="padding: 12px; border-radius: 8px; background: rgba(255,255,255,0.05); margin-bottom: 8px; display: flex; gap: 12px; align-items: center;">
        <div style="width: 48px; height: 48px; border-radius: 50%; background: linear-gradient(135deg, #3b82f6, #60a5fa); display: flex; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 18px; flex-shrink: 0; overflow: hidden;">
          ${
            user.photoURL
              ? `<img src="${user.photoURL}" alt="${
                  user.displayName || "User"
                }" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.parentElement.innerHTML='${initial}'">`
              : initial
          }
        </div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 600; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${
            user.displayName || "User"
          }</div>
          <div style="font-size: 12px; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${
            user.email
          }</div>
        </div>
        ${
          isFriend
            ? '<span style="padding: 6px 12px; border-radius: 8px; background: rgba(16,185,129,0.2); border: 1px solid #10b981; color: #10b981; font-size: 12px;"><i class="fa-solid fa-check"></i> Friends</span>'
            : `<button onclick="addFriend('${user.id}')" style="padding: 6px 12px; border-radius: 8px; background: #10b981; border: none; color: white; cursor: pointer; font-size: 12px;">
            <i class="fa-solid fa-user-plus"></i> Add
          </button>`
        }
      </div>
    `;
      })
      .join("");
  } catch (error) {
    console.error("Error searching users:", error);
    searchResults.innerHTML =
      '<p style="color: #ef4444; text-align: center;">Error searching users</p>';
  }
}

async function addFriend(friendId) {
  if (!currentUser) return;

  try {
    const userRef = doc(window.firebaseDb, "users", currentUser.uid);
    const userDoc = await getDoc(userRef);
    const currentFriends = userDoc.data()?.friends || [];

    if (currentFriends.includes(friendId)) {
      alert("Already friends!");
      return;
    }

    await updateDoc(userRef, {
      friends: [...currentFriends, friendId],
    });

    const friendRef = doc(window.firebaseDb, "users", friendId);
    const friendDoc = await getDoc(friendRef);
    const friendFriends = friendDoc.data()?.friends || [];
    await updateDoc(friendRef, {
      friends: [...friendFriends, currentUser.uid],
    });

    document.getElementById("find-friends-modal").style.display = "none";
    loadFriendsList();
  } catch (error) {
    console.error("Error adding friend:", error);
    alert("Failed to add friend");
  }
}

async function openChat(friendId) {
  currentChatFriend = friendId;

  const chatHeader = document.getElementById("chat-header");
  const chatFriendName = document.getElementById("chat-friend-name");
  const messagesContainer = document.getElementById("messages-container");
  const messageInputArea = document.getElementById("message-input-area");

  try {
    const friendDoc = await getDoc(doc(window.firebaseDb, "users", friendId));
    const friendData = friendDoc.data();
    currentChatFriendData = friendData;

    chatFriendName.textContent =
      friendData?.displayName || friendData?.email || "Friend";
    chatHeader.style.display = "block";
    messageInputArea.style.display = "flex";

    loadMessages(friendId);
  } catch (error) {
    console.error("Error opening chat:", error);
  }
}

async function loadMessages(friendId) {
  const messagesContainer = document.getElementById("messages-container");
  if (!messagesContainer) return;

  const chatId = [currentUser.uid, friendId].sort().join("_");

  try {
    const messagesRef = collection(
      window.firebaseDb,
      "chats",
      chatId,
      "messages"
    );
    const q = query(messagesRef, orderBy("timestamp", "asc"));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      messagesContainer.innerHTML =
        '<div style="text-align: center; margin: auto;"><i class="fa-regular fa-message" style="font-size: 48px; color: #94a3b8; margin-bottom: 12px;"></i><p style="color: #94a3b8;">No messages yet. Start the conversation!</p></div>';
      return;
    }

    messagesContainer.innerHTML = snapshot.docs
      .map((doc) => {
        const msg = doc.data();
        const isMe = msg.senderId === currentUser.uid;
        const time = msg.timestamp?.toDate?.();
        const timeStr = time
          ? time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : "";

        const myPhotoURL = currentUser.photoURL;
        const friendPhotoURL = currentChatFriendData?.photoURL;
        const photoURL = isMe ? myPhotoURL : friendPhotoURL;
        const initial = isMe
          ? currentUser.displayName?.[0] || currentUser.email?.[0] || "M"
          : currentChatFriendData?.displayName?.[0] ||
            currentChatFriendData?.email?.[0] ||
            "F";

        return `
        <div style="display: flex; ${
          isMe ? "flex-direction: row-reverse;" : ""
        } gap: 8px; margin-bottom: 16px; align-items: flex-end;">
          <div style="width: 32px; height: 32px; border-radius: 50%; background: ${
            isMe
              ? "linear-gradient(135deg, #e91e63, #f06292)"
              : "linear-gradient(135deg, #3b82f6, #60a5fa)"
          }; display: flex; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 14px; flex-shrink: 0; overflow: hidden;">
            ${
              photoURL
                ? `<img src="${photoURL}" alt="Avatar" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.parentElement.innerHTML='${initial}'">`
                : initial
            }
          </div>
          <div style="max-width: 65%; display: flex; flex-direction: column; ${
            isMe ? "align-items: flex-end;" : "align-items: flex-start;"
          }">
            <div style="padding: 12px 16px; border-radius: ${
              isMe ? "18px 18px 4px 18px" : "18px 18px 18px 4px"
            }; background: ${
          isMe
            ? "linear-gradient(135deg, #e91e63, #ec407a)"
            : "rgba(71, 85, 105, 0.5)"
        }; color: white; box-shadow: 0 2px 8px rgba(0,0,0,0.2); backdrop-filter: blur(10px); border: 1px solid ${
          isMe ? "rgba(233, 30, 99, 0.3)" : "rgba(255,255,255,0.1)"
        };">
              <p style="margin: 0; word-wrap: break-word; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(
                msg.text
              )}</p>
            </div>
            <div style="font-size: 11px; color: #94a3b8; margin-top: 4px; padding: 0 4px; display: flex; align-items: center; gap: 4px;">
              <i class="fa-solid fa-clock" style="font-size: 9px;"></i>
              ${timeStr}
            </div>
          </div>
        </div>
      `;
      })
      .join("");

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  } catch (error) {
    console.error("Error loading messages:", error);
    messagesContainer.innerHTML =
      '<p style="color: #ef4444; text-align: center;">Error loading messages</p>';
  }
}

async function sendMessage() {
  const messageInput = document.getElementById("message-input");
  const text = messageInput?.value?.trim();

  if (!text || !currentChatFriend || !currentUser) return;

  const chatId = [currentUser.uid, currentChatFriend].sort().join("_");

  try {
    const messagesRef = collection(
      window.firebaseDb,
      "chats",
      chatId,
      "messages"
    );
    await setDoc(doc(messagesRef), {
      senderId: currentUser.uid,
      text: text,
      timestamp: new Date(),
    });

    messageInput.value = "";
    loadMessages(currentChatFriend);
  } catch (error) {
    console.error("Error sending message:", error);
    alert("Failed to send message");
  }
}

function filterFriendsList(query) {
  const friendItems = document.querySelectorAll(".friend-item");
  friendItems.forEach((item) => {
    const text = item.textContent.toLowerCase();
    item.style.display = text.includes(query.toLowerCase()) ? "block" : "none";
  });
}

window.addFriend = addFriend;

// AI Assistant Functions
const STEPHEN_CONTEXT = `You are an AI assistant with detailed knowledge about Stephen J. Amuzu. Here is comprehensive information about him:

Full Name: Stephen J. Amuzu
Professional Title: Full Stack Developer & Software Engineer
Location: Accra, Ghana
Email: stevejupiter4@gmail.com
Phone: +233532973455
Experience: 5+ years in software development

Skills & Technologies:
- Frontend: HTML, CSS, JavaScript, React, React Native
- Backend: Node.js, Express, Python
- Databases: Firebase, Supabase, PostgreSQL, MySQL
- Mobile: React Native, Expo
- AI/ML: Machine Learning, Prompt Engineering
- Tools: Git, VS Code, Docker
- Cloud: Firebase, Supabase, AWS

Education:
- Computer Science background
- Self-taught developer with continuous learning mindset

Notable Projects:
1. ExpressMart - Full-stack e-commerce platform with React Native mobile app
2. Mystiwan E-Business - Multi-vendor marketplace solution
3. AOS Portfolio OS - Interactive portfolio operating system interface
4. MystiwanAdmin - Admin dashboard for e-commerce management

Key Achievements:
- Built multiple production-ready mobile and web applications
- Expertise in Firebase and Supabase integration
- Strong focus on UI/UX and user experience
- Experience with real-time applications and cloud functions

Personality & Work Style:
- Detail-oriented and meticulous
- Passionate about clean, maintainable code
- Strong problem-solving abilities
- Excellent at translating requirements into functional software
- Collaborative team player

Career Goals:
- Building innovative solutions that solve real problems
- Continuous learning and skill development
- Contributing to open-source projects
- Mentoring junior developers

Availability: Open to freelance and full-time opportunities

When answering questions, provide helpful, accurate information about Stephen based on this context. Be friendly, professional, and informative.`;

let aiConversationHistory = [];

function initAIAssistant() {
  loadAIMemory();

  const aiInput = document.getElementById("ai-input");
  const sendBtn = document.getElementById("send-ai-message");

  if (aiInput) {
    aiInput.onkeypress = (e) => {
      if (e.key === "Enter") sendAIMessage();
    };
  }

  if (sendBtn) {
    sendBtn.onclick = sendAIMessage;
  }
}

function loadAIMemory() {
  try {
    const saved = localStorage.getItem("aos_ai_memory");
    if (saved) {
      aiConversationHistory = JSON.parse(saved);
      const chatContainer = document.getElementById("ai-chat-container");
      if (chatContainer && aiConversationHistory.length > 0) {
        const historyHTML = aiConversationHistory
          .map((msg) => {
            if (msg.role === "user") {
              return `
              <div style="display: flex; justify-content: flex-end;">
                <div style="max-width: 80%; padding: 12px; border-radius: 12px; background: rgba(59,130,246,0.2); border: 1px solid rgba(59,130,246,0.4);">
                  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                    <strong style="color: #60a5fa;">You</strong>
                  </div>
                  <p style="margin: 0; color: #e2e8f0; line-height: 1.6;">${escapeHtml(
                    msg.content
                  )}</p>
                </div>
              </div>
            `;
            }

            const assistantHtml = convertMarkdownToHtml(
              typeof msg.content === "string" ? msg.content : ""
            );
            return renderAssistantMessageHtml(assistantHtml);
          })
          .join("");
        chatContainer.innerHTML = historyHTML;
        // Scroll to bottom after loading history
        setTimeout(() => {
          chatContainer.scrollTop = chatContainer.scrollHeight;
        }, 0);
      }
    }
  } catch (error) {
    console.error("Error loading AI memory:", error);
  }
}

function saveAIMemory() {
  try {
    localStorage.setItem(
      "aos_ai_memory",
      JSON.stringify(aiConversationHistory)
    );
  } catch (error) {
    console.error("Error saving AI memory:", error);
  }
}

async function sendAIMessage() {
  const aiInput = document.getElementById("ai-input");
  const chatContainer = document.getElementById("ai-chat-container");
  const sendBtn = document.getElementById("send-ai-message");

  const userMessage = aiInput?.value?.trim();
  if (!userMessage) return;

  aiInput.value = "";
  sendBtn.disabled = true;
  sendBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Thinking...';

  aiConversationHistory.push({ role: "user", content: userMessage });

  const userMessageEl = document.createElement("div");
  userMessageEl.style.cssText = "display: flex; justify-content: flex-end;";
  userMessageEl.innerHTML = `
    <div style="max-width: 80%; padding: 12px; border-radius: 12px; background: rgba(59,130,246,0.2); border: 1px solid rgba(59,130,246,0.4);">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
        <strong style="color: #60a5fa;">You</strong>
      </div>
      <p style="margin: 0; color: #e2e8f0; line-height: 1.6;">${escapeHtml(
        userMessage
      )}</p>
    </div>
  `;
  chatContainer.appendChild(userMessageEl);
  userMessageEl.scrollIntoView({ behavior: "smooth", block: "end" });

  try {
    const markdownResponse = await callHuggingFaceAPI(userMessage);

    aiConversationHistory.push({
      role: "assistant",
      content: markdownResponse.markdown,
    });
    saveAIMemory();

    const assistantMessageEl = document.createElement("div");
    assistantMessageEl.innerHTML = renderAssistantMessageHtml(
      markdownResponse.html
    );
    chatContainer.appendChild(assistantMessageEl);
    assistantMessageEl.scrollIntoView({ behavior: "smooth", block: "end" });
  } catch (error) {
    console.error("AI Error:", error);
    const errorMessageEl = document.createElement("div");
    errorMessageEl.innerHTML = `
      <div style="padding: 12px; border-radius: 12px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3);">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
          <i class="fa-solid fa-exclamation-triangle" style="color: #ef4444;"></i>
          <strong style="color: #ef4444;">Error</strong>
        </div>
        <p style="margin: 0; color: #e2e8f0; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(
          error.message ||
            "Sorry, I encountered an error. Please try again later."
        )}</p>
      </div>
    `;
    chatContainer.appendChild(errorMessageEl);
    errorMessageEl.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  sendBtn.disabled = false;
  sendBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send';
}

async function callHuggingFaceAPI(userMessage) {
  try {
    // Get API key from edge function
    const keyResponse = await fetch(
      "https://tetgyhnqikauxjlrseiz.supabase.co/functions/v1/aos-services/ai",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:
            "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRldGd5aG5xaWthdXhqbHJzZWl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5NzQzNTcsImV4cCI6MjA4MDU1MDM1N30.pXn0IBCfI9_A182qoYfN36L0g9PXuABD1wCjaOpU18M",
        },
        body: JSON.stringify({}),
      }
    );

    if (!keyResponse.ok) {
      throw new Error("Failed to retrieve API key");
    }

    const keyResult = await keyResponse.json();
    const HF_API_KEY = keyResult.apiKey;

    if (!HF_API_KEY) {
      throw new Error("API key not available");
    }

    // Build messages array for chat completion
    const messages = [
      {
        role: "system",
        content: STEPHEN_CONTEXT,
      },
    ];

    // Add conversation history (last 6 messages)
    aiConversationHistory.slice(-6).forEach((msg) => {
      messages.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.content,
      });
    });

    // Add current user message
    messages.push({
      role: "user",
      content: userMessage,
    });

    // Call HuggingFace router API directly
    const response = await fetch(
      "https://router.huggingface.co/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HF_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: messages,
          model: "Qwen/Qwen2.5-72B-Instruct",
          max_tokens: 500,
          temperature: 0.7,
          top_p: 0.95,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error?.message ||
          errorData.error ||
          `HuggingFace API error: ${response.status} - ${response.statusText}`
      );
    }

    const result = await response.json();
    console.log("AI API Response:", result);

    if (result.choices && result.choices[0]?.message?.content) {
      const markdown = result.choices[0].message.content.trim();
      return {
        markdown: markdown,
        html: convertMarkdownToHtml(markdown),
      };
    } else {
      throw new Error("Failed to get AI response");
    }
  } catch (error) {
    console.error("AI API Error:", error);
    throw error;
  }
}

function convertMarkdownToHtml(markdown) {
  if (!markdown) return "";

  const sanitizedMarkdown = markdown
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/javascript:/gi, "");

  if (typeof window.marked?.parse === "function") {
    return sanitizeAssistantHtml(window.marked.parse(sanitizedMarkdown));
  }

  const escaped = escapeHtml(sanitizedMarkdown);
  const codeBlockMap = new Map();
  let blockIndex = 0;
  let processed = escaped.replace(/```([\s\S]*?)```/g, (_, code) => {
    const safeCode = code.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const placeholder = `__CODE_BLOCK_${blockIndex}__`;
    codeBlockMap.set(placeholder, `<pre><code>${safeCode}</code></pre>`);
    blockIndex++;
    return placeholder;
  });

  processed = processed
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, (match, code) => {
      return `<code>${code}</code>`;
    });

  const lines = processed.split(/\r?\n/);
  const htmlParts = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      htmlParts.push("</ul>");
      inList = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      closeList();
      continue;
    }

    if (line.startsWith("__CODE_BLOCK_")) {
      closeList();
      htmlParts.push(codeBlockMap.get(line) || "");
      continue;
    }

    if (/^#{1,6}\s+/.test(line)) {
      closeList();
      const level = line.match(/^#+/)[0].length;
      const text = line.replace(/^#{1,6}\s+/, "");
      htmlParts.push(`<h${level}>${text}</h${level}>`);
      continue;
    }

    if (/^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      if (!inList) {
        htmlParts.push("<ul>");
        inList = true;
      }
      const itemText = line.replace(/^([-*+]|\d+\.)\s+/, "");
      htmlParts.push(`<li>${itemText}</li>`);
      continue;
    }

    closeList();
    htmlParts.push(`<p>${line}</p>`);
  }

  closeList();

  let html = htmlParts.join("");

  for (const [placeholder, blockHtml] of codeBlockMap.entries()) {
    html = html.replace(new RegExp(placeholder, "g"), blockHtml);
  }

  return sanitizeAssistantHtml(html);
}

function sanitizeAssistantHtml(html) {
  if (!html) return "";
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<iframe[^>]*>/gi, "")
    .replace(/<object[\s\S]*?>[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[\s\S]*?>[\s\S]*?<\/embed>/gi, "")
    .replace(/on[a-z]+="[^"]*"/gi, "")
    .replace(/on[a-z]+='[^']*'/gi, "")
    .replace(/javascript:/gi, "");
}

function renderAssistantMessageHtml(bodyHtml) {
  const safeBody = sanitizeAssistantHtml(bodyHtml);
  const content =
    safeBody && safeBody.trim().length > 0
      ? safeBody
      : "<p>I do not have a response to display.</p>";
  return `
    <div class="ai-response">
      <div class="ai-response-header">
        <i class="fa-solid fa-robot"></i>
        <strong>AOS AI</strong>
      </div>
      <div class="ai-response-body">${content}</div>
    </div>
  `;
}

function generateFallbackResponse(userMessage) {
  const lowerMessage = userMessage.toLowerCase();

  if (lowerMessage.includes("skill") || lowerMessage.includes("technolog")) {
    return "Stephen J. Amuzu is skilled in JavaScript, React, React Native, Node.js, Express, Python, Firebase, Supabase, and more. He has 5+ years of experience building full-stack applications.";
  } else if (lowerMessage.includes("project")) {
    return "Stephen has built several notable projects including ExpressMart (e-commerce platform), Mystiwan E-Business (multi-vendor marketplace), and this AOS Portfolio OS you're using right now!";
  } else if (
    lowerMessage.includes("contact") ||
    lowerMessage.includes("email")
  ) {
    return "You can reach Stephen at stevejupiter4@gmail.com or call +233532973455. He is based in Accra, Ghana.";
  } else if (lowerMessage.includes("experience")) {
    return "Stephen has 5+ years of professional software development experience, specializing in full-stack web and mobile applications using modern technologies.";
  } else {
    return "Stephen J. Amuzu is a talented Full Stack Developer from Accra, Ghana with expertise in React, React Native, Node.js, and cloud technologies. Feel free to ask me specific questions about his skills, projects, or experience!";
  }
}

function completeBootSequence() {
  if (bootComplete) return;
  bootComplete = true;

  const bootScreen = document.getElementById("bootScreen");
  if (!bootScreen) return;

  // Ensure minimum boot time of 1.8 seconds
  const minBootTime = 1800;
  const elapsed = Date.now() - (window.bootStartTime || 0);
  const delay = Math.max(0, minBootTime - elapsed);

  setTimeout(() => {
    bootScreen.classList.add("boot-complete");
    setTimeout(() => bootScreen.remove(), 800);
  }, delay);
}

// Make database functions globally available
window.loadCollection = loadCollection;
window.viewDocument = viewDocument;
window.refreshDatabase = refreshDatabase;
window.handleSecretKnock = handleSecretKnock;
window.showAddProjectModal = showAddProjectModal;
window.showAddUpdateModal = showAddUpdateModal;
window.saveProject = saveProject;
window.saveUpdate = saveUpdate;
window.showUploadProjectsModal = showUploadProjectsModal;
window.loadProjectsFromFirebase = loadProjectsFromFirebase;
window.initFileManager = initFileManager;

// Database Management Functions
async function loadCollection(collectionName) {
  if (!window.firebaseDb) return;

  // For media collections, require user to be logged in
  const mediaCollections = [
    "user_pictures",
    "user_music",
    "user_videos",
    "user_documents",
    "all_files",
  ];
  if (mediaCollections.includes(collectionName) && !currentUser) {
    const documentsContainer = document.getElementById("documents-container");
    if (documentsContainer) {
      documentsContainer.innerHTML = `<p style="color: #ef4444; text-align: center; margin: 40px 0;">Please sign in to view media files.</p>`;
    }
    return;
  }

  try {
    let allDocs = [];
    let title = `Collection: ${collectionName}`;

    if (collectionName === "all_files") {
      // Load from all media collections
      const mediaCollections = [
        "user_pictures",
        "user_music",
        "user_videos",
        "user_documents",
      ];
      title = "All Files";

      for (const collName of mediaCollections) {
        const collectionRef = collection(window.firebaseDb, collName);
        const q = query(collectionRef);
        const querySnapshot = await getDocs(q);

        querySnapshot.forEach((docSnap) => {
          const data = docSnap.data();
          if (!data.deleted) {
            allDocs.push({
              id: docSnap.id,
              collection: collName,
              ...data,
            });
          }
        });
      }

      // Sort all files by uploadedAt desc
      allDocs.sort((a, b) => {
        const aTime = a.uploadedAt?.toDate?.() || new Date(a.uploadedAt || 0);
        const bTime = b.uploadedAt?.toDate?.() || new Date(b.uploadedAt || 0);
        return bTime - aTime;
      });
    } else {
      // Load single collection
      const collectionRef = collection(window.firebaseDb, collectionName);
      const q = query(collectionRef);
      const querySnapshot = await getDocs(q);

      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (!data.deleted) {
          allDocs.push({ id: docSnap.id, ...data });
        }
      });

      // Sort by uploadedAt desc for media collections
      if (
        [
          "user_pictures",
          "user_music",
          "user_videos",
          "user_documents",
        ].includes(collectionName)
      ) {
        allDocs.sort((a, b) => {
          const aTime = a.uploadedAt?.toDate?.() || new Date(a.uploadedAt || 0);
          const bTime = b.uploadedAt?.toDate?.() || new Date(b.uploadedAt || 0);
          return bTime - aTime;
        });
      }
    }

    const documentsContainer = document.getElementById("documents-container");
    const currentTitle = document.getElementById("current-collection-title");

    if (currentTitle) currentTitle.textContent = title;

    if (documentsContainer) {
      let html = `<div style="display: flex; flex-direction: column; gap: 12px;">`;

      if (allDocs.length === 0) {
        html += `<p style="color: #94a3b8; text-align: center; margin: 40px 0;">No files found</p>`;
      } else {
        const isAdmin = currentUser?.email === "stevejupiter4@gmail.com";
        const isMediaCollection =
          collectionName === "all_files" ||
          [
            "user_pictures",
            "user_music",
            "user_videos",
            "user_documents",
          ].includes(collectionName);

        allDocs.forEach((doc) => {
          if (isMediaCollection) {
            // Special rendering for media files
            const fileName = doc.fileName || doc.name || "Unknown File";
            const fileSize = doc.fileSize
              ? `${(doc.fileSize / 1024 / 1024).toFixed(1)} MB`
              : "Unknown size";
            const publicUrl = doc.publicUrl || doc.url || "";
            const fileType = doc.fileType || doc.type || "";
            const actualCollection = doc.collection || collectionName;

            let mediaPreview = "";
            let fileIcon = "";
            let fileColor = "#38bdf8";

            if (actualCollection === "user_pictures" && publicUrl) {
              mediaPreview = `<img src="${publicUrl}" alt="${fileName}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 8px; margin-right: 12px;">`;
            } else {
              if (actualCollection === "user_music") {
                fileIcon = "fa-music";
                fileColor = "#38bdf8";
              } else if (actualCollection === "user_videos") {
                fileIcon = "fa-film";
                fileColor = "#f59e0b";
              } else if (actualCollection === "user_documents") {
                fileIcon = "fa-file-lines";
                fileColor = "#f59e0b";
              } else if (actualCollection === "user_pictures") {
                fileIcon = "fa-image";
                fileColor = "#10b981";
              }

              if (fileIcon) {
                mediaPreview = `<i class="fa-solid ${fileIcon}" style="font-size: 24px; color: ${fileColor}; margin-right: 12px;"></i>`;
              }
            }

            const collectionLabel =
              collectionName === "all_files"
                ? `<span style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 8px;">${actualCollection.replace(
                    "user_",
                    ""
                  )}</span>`
                : "";

            html += `
              <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); position: relative;">
                ${mediaPreview}
                <div style="flex: 1;">
                  <p style="margin: 0; color: #e2e8f0; font-weight: 500;">${fileName}${collectionLabel}</p>
                  <p style="margin: 2px 0 0 0; color: #94a3b8; font-size: 12px;">${fileSize} • ${fileType}</p>
                </div>
                ${
                  publicUrl
                    ? `<a href="${publicUrl}" target="_blank" style="padding: 6px 12px; border-radius: 6px; background: #38bdf8; color: white; text-decoration: none; font-size: 12px;">View</a>`
                    : ""
                }
                ${
                  isAdmin
                    ? `<button onclick="deleteFile('${actualCollection}', '${
                        doc.id
                      }', '${
                        doc.path || doc.filePath || ""
                      }'); loadCollection('${collectionName}');" style="position: absolute; top: 8px; right: 8px; background: rgba(239,68,68,0.8); border: none; border-radius: 50%; width: 24px; height: 24px; color: white; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 12px;"><i class="fa-solid fa-trash"></i></button>`
                    : ""
                }
              </div>
            `;
          } else {
            // Default rendering for other collections
            html += `
              <div style="padding: 16px; border-radius: 8px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); backdrop-filter: blur(12px);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                  <h4 style="margin: 0; color: #38bdf8;">Document ID: ${
                    doc.id
                  }</h4>
                  <button onclick="viewDocument('${collectionName}', '${
              doc.id
            }')" style="padding: 4px 8px; border-radius: 4px; background: #6366f1; border: none; color: white; cursor: pointer; font-size: 12px;">View</button>
                </div>
                <div style="font-size: 14px; color: #94a3b8;">
                  ${Object.keys(doc).length} fields • Created: ${
              doc.uploadedAt
                ? doc.uploadedAt.toDate?.()?.toLocaleString() ||
                  new Date(doc.uploadedAt).toLocaleString()
                : doc.createdAt
                ? doc.createdAt.toDate?.()?.toLocaleString() ||
                  new Date(doc.createdAt).toLocaleString()
                : "Unknown"
            }
                </div>
              </div>
            `;
          }
        });
      }

      html += `</div>`;
      documentsContainer.innerHTML = html;
    }
  } catch (error) {
    console.error("Error loading collection:", error);
    const documentsContainer = document.getElementById("documents-container");
    if (documentsContainer) {
      documentsContainer.innerHTML = `<p style="color: #ef4444; text-align: center; margin: 40px 0;">Error loading collection: ${error.message}</p>`;
    }
  }
}

async function viewDocument(collectionName, docId) {
  if (!window.firebaseDb) return;

  try {
    const docRef = doc(window.firebaseDb, collectionName, docId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = { id: docSnap.id, ...docSnap.data() };
      const jsonString = JSON.stringify(data, null, 2);

      // Create a modal or new window to show document details
      const modal = document.createElement("div");
      modal.className = "modal-overlay";
      modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.8); z-index: 1000; display: flex;
        align-items: center; justify-content: center;
      `;

      modal.innerHTML = `
        <div style="background: rgba(15,23,42,0.95); border-radius: 16px; padding: 24px; max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto; border: 1px solid rgba(255,255,255,0.1);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h3 style="margin: 0; color: #38bdf8;">Document: ${docId}</h3>
            <button onclick="this.closest('.modal-overlay').remove()" style="background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 20px;">×</button>
          </div>
          <pre style="background: rgba(0,0,0,0.5); padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 12px; color: #e2e8f0;">${jsonString}</pre>
        </div>
      `;

      document.body.appendChild(modal);
    } else {
      alert("Document not found!");
    }
  } catch (error) {
    console.error("Error viewing document:", error);
    alert("Error viewing document: " + error.message);
  }
}

async function refreshDatabase() {
  // Refresh the current collection if one is selected
  const currentTitle = document.getElementById("current-collection-title");
  if (currentTitle && currentTitle.textContent !== "Select a collection") {
    const collectionName = currentTitle.textContent.replace("Collection: ", "");
    loadCollection(collectionName);
  }
}

// Secret Admin Functions
let secretKnockCount = 0;
function handleSecretKnock() {
  secretKnockCount++;
  if (secretKnockCount >= 3) {
    const adminPanel = document.getElementById("admin-panel");
    if (adminPanel) {
      adminPanel.style.display =
        adminPanel.style.display === "none" ? "block" : "none";
      secretKnockCount = 0; // Reset counter
    }
  }

  // Reset counter after 2 seconds
  setTimeout(() => {
    secretKnockCount = 0;
  }, 2000);
}

function showAddProjectModal() {
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
    background: rgba(0,0,0,0.8); z-index: 1000; display: flex; 
    align-items: center; justify-content: center;
  `;

  modal.innerHTML = `
    <div style="background: rgba(15,23,42,0.95); border-radius: 16px; padding: 24px; max-width: 500px; width: 90%; border: 1px solid rgba(255,255,255,0.1);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h3 style="margin: 0; color: #ff6b35;">Add New Project</h3>
        <button onclick="this.closest('.modal-overlay').remove()" style="background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 20px;">×</button>
      </div>
      <form onsubmit="saveProject(event)">
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; color: #e2e8f0;">Project Title</label>
          <input type="text" id="project-title" required style="width: 100%; padding: 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: white;">
        </div>
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; color: #e2e8f0;">Description</label>
          <textarea id="project-description" required style="width: 100%; padding: 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: white; min-height: 80px;"></textarea>
        </div>
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; color: #e2e8f0;">Project Image</label>
          <input type="file" id="project-image" accept="image/*" style="width: 100%; padding: 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: white;">
        </div>
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; color: #e2e8f0;">Technology Stack</label>
          <div id="tech-stack-container" style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;"></div>
          <input type="text" id="tech-search" placeholder="Search technologies..." style="width: 100%; padding: 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: white;">
          <div id="tech-suggestions" style="max-height: 150px; overflow-y: auto; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; background: rgba(0,0,0,0.5); display: none;"></div>
        </div>
        <div style="margin-bottom: 20px;">
          <label style="display: block; margin-bottom: 8px; color: #e2e8f0;">GitHub URL (optional)</label>
          <input type="url" id="project-github" style="width: 100%; padding: 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: white;">
        </div>
        <div style="margin-bottom: 20px;">
          <label style="display: block; margin-bottom: 8px; color: #e2e8f0;">Project URL (optional)</label>
          <input type="url" id="project-url" placeholder="https://" style="width: 100%; padding: 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: white;">
        </div>
        <div style="margin-bottom: 24px;">
          <label style="display: block; margin-bottom: 8px; color: #e2e8f0;">Download Link (optional)</label>
          <input type="url" id="project-download" placeholder="https://" style="width: 100%; padding: 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: white;">
        </div>
        <button type="submit" style="padding: 12px 24px; border-radius: 8px; background: #ff6b35; border: none; color: white; cursor: pointer; width: 100%;">Save Project</button>
      </form>
    </div>
  `;

  document.body.appendChild(modal);

  // Add backdrop click handler
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });

  // Initialize tech stack functionality
  initTechStackSelector();
}

function showAddUpdateModal() {
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
    background: rgba(0,0,0,0.8); z-index: 1000; display: flex; 
    align-items: center; justify-content: center;
  `;

  modal.innerHTML = `
    <div style="background: rgba(15,23,42,0.95); border-radius: 16px; padding: 24px; max-width: 500px; width: 90%; border: 1px solid rgba(255,255,255,0.1);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h3 style="margin: 0; color: #ff6b35;">Add New Update</h3>
        <button onclick="this.closest('.modal-overlay').remove()" style="background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 20px;">×</button>
      </div>
      <form onsubmit="saveUpdate(event)">
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; color: #e2e8f0;">Update Title</label>
          <input type="text" id="update-title" required style="width: 100%; padding: 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: white;">
        </div>
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; color: #e2e8f0;">Content</label>
          <textarea id="update-content" required style="width: 100%; padding: 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: white; min-height: 100px;"></textarea>
        </div>
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; color: #e2e8f0;">Type</label>
          <select id="update-type" style="width: 100%; padding: 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: white;">
            <option value="feature">New Feature</option>
            <option value="improvement">Improvement</option>
            <option value="bugfix">Bug Fix</option>
            <option value="announcement">Announcement</option>
          </select>
        </div>
        <button type="submit" style="padding: 12px 24px; border-radius: 8px; background: #ff6b35; border: none; color: white; cursor: pointer; width: 100%;">Save Update</button>
      </form>
    </div>
  `;

  document.body.appendChild(modal);

  // Add backdrop click handler
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

async function uploadProjectImageToSupabase(imageFile, projectId) {
  if (!imageFile) return null;

  if (!window.supabaseClient?.storage) {
    throw new Error("Supabase storage client not available");
  }

  const bucket = "project-images";
  const fileExt = imageFile.name.split(".").pop()?.toLowerCase() || "jpg";
  const uniqueSuffix =
    (window.crypto?.randomUUID && window.crypto.randomUUID()) ||
    Math.random().toString(36).slice(2, 10);
  const filePath = `${projectId}-${uniqueSuffix}.${fileExt}`;

  const { data, error } = await window.supabaseClient.storage
    .from(bucket)
    .upload(filePath, imageFile, {
      cacheControl: "3600",
      upsert: false,
    });

  if (error) throw error;

  const { data: publicUrlData, error: publicUrlError } =
    window.supabaseClient.storage.from(bucket).getPublicUrl(filePath);

  if (publicUrlError) throw publicUrlError;

  const { data: signedUrlData, error: signedUrlError } =
    await window.supabaseClient.storage
      .from(bucket)
      .createSignedUrl(filePath, 60 * 60 * 24 * 365);

  if (signedUrlError) throw signedUrlError;

  return {
    path: data.path,
    publicUrl: publicUrlData.publicUrl,
    downloadUrl: signedUrlData.signedUrl,
  };
}

async function saveProject(event) {
  event.preventDefault();

  const title = document.getElementById("project-title").value;
  const description = document.getElementById("project-description").value;
  const github = document.getElementById("project-github").value;
  const projectUrl = document.getElementById("project-url").value;
  const downloadLink = document.getElementById("project-download").value;
  const imageFile = document.getElementById("project-image").files[0];
  const techStack = Array.from(
    document.querySelectorAll("#tech-stack-container .tech-badge")
  ).map((badge) => badge.textContent.replace("×", "").trim());

  if (!window.firebaseDb) {
    alert("Firebase database not available");
    return;
  }

  try {
    const projectId = Date.now().toString();
    const uploadedImage = await uploadProjectImageToSupabase(
      imageFile,
      projectId
    );

    const projectData = {
      id: projectId,
      title,
      description,
      technology: techStack,
      github: github || null,
      projectUrl: projectUrl || null,
      downloadLink: downloadLink || null,
      imageUrl: uploadedImage?.publicUrl || null,
      imageDownloadUrl: uploadedImage?.downloadUrl || null,
      imageStoragePath: uploadedImage?.path || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Save to Firebase Firestore
    const projectRef = doc(window.firebaseDb, "projects", projectId);
    await setDoc(projectRef, projectData);

    alert("Project added successfully!");
    event.target.closest("div").parentElement.remove(); // Close modal

    // Refresh Projects window if it's open
    if (document.getElementById("projects-grid")) {
      loadProjectsFromFirebase();
    }

    // Refresh if currently viewing projects
    const currentTitle = document.getElementById("current-collection-title");
    if (currentTitle && currentTitle.textContent === "Collection: projects") {
      loadCollection("projects");
    }
  } catch (error) {
    console.error("Error saving project:", error);
    alert("Error saving project: " + error.message);
  }
}

function initTechStackSelector() {
  const techSearch = document.getElementById("tech-search");
  const techContainer = document.getElementById("tech-stack-container");
  const suggestions = document.getElementById("tech-suggestions");

  const technologies = [
    "React",
    "Vue.js",
    "Angular",
    "Svelte",
    "Next.js",
    "Nuxt.js",
    "Gatsby",
    "Node.js",
    "Express.js",
    "FastAPI",
    "Django",
    "Flask",
    "Spring Boot",
    "JavaScript",
    "TypeScript",
    "Python",
    "Java",
    "C#",
    "Go",
    "Rust",
    "PHP",
    "HTML5",
    "CSS3",
    "Sass",
    "Tailwind CSS",
    "Bootstrap",
    "Material-UI",
    "Firebase",
    "MongoDB",
    "PostgreSQL",
    "MySQL",
    "Redis",
    "SQLite",
    "AWS",
    "Google Cloud",
    "Azure",
    "Vercel",
    "Netlify",
    "Heroku",
    "Docker",
    "Kubernetes",
    "Git",
    "GitHub",
    "GitLab",
    "Bitbucket",
    "Jest",
    "Cypress",
    "Selenium",
    "Mocha",
    "Chai",
    "Testing Library",
    "Webpack",
    "Vite",
    "Parcel",
    "Babel",
    "ESLint",
    "Prettier",
    "Figma",
    "Adobe XD",
    "Sketch",
    "Photoshop",
    "Illustrator",
    "Linux",
    "macOS",
    "Windows",
    "Android",
    "iOS",
    "React Native",
    "Flutter",
  ];

  techSearch.addEventListener("input", (e) => {
    const query = e.target.value.toLowerCase();
    if (query.length < 1) {
      suggestions.style.display = "none";
      return;
    }

    const filtered = technologies.filter(
      (tech) =>
        tech.toLowerCase().includes(query) &&
        !Array.from(techContainer.children).some(
          (badge) =>
            badge.textContent.replace("×", "").trim().toLowerCase() ===
            tech.toLowerCase()
        )
    );

    suggestions.innerHTML = filtered
      .slice(0, 10)
      .map(
        (tech) =>
          `<div style="padding: 8px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.1);" onclick="addTechBadge('${tech}')">${tech}</div>`
      )
      .join("");

    suggestions.style.display = filtered.length > 0 ? "block" : "none";
  });

  techSearch.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const query = techSearch.value.trim();
      if (
        query &&
        technologies.some((tech) => tech.toLowerCase() === query.toLowerCase())
      ) {
        addTechBadge(query);
        techSearch.value = "";
        suggestions.style.display = "none";
      }
    }
  });
}

function addTechBadge(tech) {
  const container = document.getElementById("tech-stack-container");
  const existingBadges = Array.from(container.children).map((badge) =>
    badge.textContent.replace("×", "").trim()
  );

  if (existingBadges.includes(tech)) return;

  const badge = document.createElement("div");
  badge.className = "tech-badge";
  badge.style.cssText = `
    display: inline-flex; align-items: center; gap: 4px; 
    background: #ff6b35; color: white; padding: 4px 8px; 
    border-radius: 12px; font-size: 12px; cursor: pointer;
  `;
  badge.innerHTML = `${tech} <span onclick="removeTechBadge(this)" style="cursor: pointer;">×</span>`;

  container.appendChild(badge);
  document.getElementById("tech-search").value = "";
  document.getElementById("tech-suggestions").style.display = "none";
}

function removeTechBadge(element) {
  element.parentElement.remove();
}

async function saveUpdate(event) {
  event.preventDefault();

  const title = document.getElementById("update-title").value;
  const content = document.getElementById("update-content").value;
  const type = document.getElementById("update-type").value;

  if (!window.firebaseDb) {
    alert("Firebase database not available");
    return;
  }

  try {
    const updateId = Date.now().toString();
    const updateData = {
      id: updateId,
      title,
      content,
      type,
      createdAt: new Date(),
      published: true,
    };

    // Save to Firebase Firestore
    const updateRef = doc(window.firebaseDb, "updates", updateId);
    await setDoc(updateRef, updateData);

    alert("Update added successfully!");
    event.target.closest("div").parentElement.remove(); // Close modal

    // Refresh if currently viewing updates
    const currentTitle = document.getElementById("current-collection-title");
    if (currentTitle && currentTitle.textContent === "Collection: updates") {
      loadCollection("updates");
    }
  } catch (error) {
    console.error("Error saving update:", error);
    alert("Error saving update: " + error.message);
  }
}

function showUploadProjectsModal() {
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
    background: rgba(0,0,0,0.8); z-index: 1000; display: flex; 
    align-items: center; justify-content: center;
  `;

  modal.innerHTML = `
    <div style="background: rgba(15,23,42,0.95); border-radius: 16px; padding: 24px; max-width: 600px; width: 90%; border: 1px solid rgba(255,255,255,0.1);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h3 style="margin: 0; color: #ff6b35;">Upload Projects</h3>
        <button onclick="this.closest('.modal-overlay').remove()" style="background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 20px;">×</button>
      </div>
      
      <div style="margin-bottom: 20px;">
        <p style="color: #e2e8f0; margin-bottom: 16px;">Quick project upload options:</p>
        <div style="display: flex; gap: 12px; flex-wrap: wrap;">
          <button onclick="showAddProjectModal()" style="padding: 12px 20px; border-radius: 8px; background: #38bdf8; border: none; color: white; cursor: pointer; display: flex; align-items: center; gap: 8px;">
            <i class="fa-solid fa-plus"></i>Add New Project
          </button>
          <button onclick="bulkUploadProjects()" style="padding: 12px 20px; border-radius: 8px; background: #10b981; border: none; color: white; cursor: pointer; display: flex; align-items: center; gap: 8px;">
            <i class="fa-solid fa-upload"></i>Bulk Upload
          </button>
          <button onclick="manageExistingProjects()" style="padding: 12px 20px; border-radius: 8px; background: #f59e0b; border: none; color: white; cursor: pointer; display: flex; align-items: center; gap: 8px;">
            <i class="fa-solid fa-edit"></i>Manage Projects
          </button>
        </div>
      </div>
      
      <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 16px;">
        <h4 style="margin: 0 0 12px 0; color: #e2e8f0;">Recent Activity</h4>
        <div id="recent-activity" style="color: #94a3b8; font-size: 14px;">
          Loading recent activity...
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Add backdrop click handler
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });

  // Load recent activity
  loadRecentActivity();
}

async function loadRecentActivity() {
  const activityContainer = document.getElementById("recent-activity");
  if (!activityContainer) return;

  try {
    // Load recent projects
    if (window.supabaseClient) {
      const { data, error } = await window.supabaseClient
        .from("projects")
        .select("title, created_at")
        .order("created_at", { ascending: false })
        .limit(3);

      if (error) throw error;

      let activityHtml =
        "<div style='margin-bottom: 8px;'><strong>Recent Projects:</strong></div>";

      if (data && data.length > 0) {
        data.forEach((project) => {
          activityHtml += `<div style='margin-left: 12px; margin-bottom: 4px;'>• ${
            project.title
          } (${new Date(project.created_at).toLocaleDateString()})</div>`;
        });
      } else {
        activityHtml +=
          "<div style='margin-left: 12px; color: #94a3b8;'>No recent projects</div>";
      }

      activityContainer.innerHTML = activityHtml;
    }
  } catch (error) {
    console.error("Error loading recent activity:", error);
    activityContainer.innerHTML = "Error loading recent activity";
  }
}

function bulkUploadProjects() {
  alert(
    "Bulk upload feature coming soon! For now, use 'Add New Project' to upload individual projects."
  );
}

function manageExistingProjects() {
  // Open the database manager and navigate to projects collection
  const dbWindow = windows.find((w) => w.title === "Supabase Database");
  if (dbWindow) {
    focusWindow(dbWindow.id);
    // Try to load projects collection
    setTimeout(() => loadCollection("projects"), 100);
  } else {
    openWindow("Supabase Database", "fa-solid fa-database");
    setTimeout(() => loadCollection("projects"), 500);
  }

  // Close the upload modal
  document.querySelector(".modal-overlay")?.remove();
}

// Profile Widget Functions
function initProfileWidget() {
  const widget = document.getElementById("profileWidget");
  if (!widget) return;

  // Set random width between 280-360px
  const randomWidth = Math.floor(Math.random() * (360 - 280 + 1)) + 280;
  widget.style.width = `${randomWidth}px`;

  // Make widget draggable
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };

  widget.addEventListener("mousedown", (e) => {
    // Only allow dragging from the header
    if (!e.target.closest(".profile-header")) return;

    isDragging = true;
    const rect = widget.getBoundingClientRect();
    dragOffset = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    widget.style.cursor = "grabbing";
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;

    const newX = e.clientX - dragOffset.x;
    const newY = e.clientY - dragOffset.y;

    // Keep widget within viewport bounds
    const maxX = window.innerWidth - widget.offsetWidth;
    const maxY = window.innerHeight - widget.offsetHeight;

    widget.style.left = `${Math.max(0, Math.min(newX, maxX))}px`;
    widget.style.top = `${Math.max(0, Math.min(newY, maxY))}px`;
    widget.style.right = "auto"; // Remove fixed right positioning
  });

  document.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      widget.style.cursor = "move";
    }
  });
}

function closeProfileWidget() {
  const widget = document.getElementById("profileWidget");
  if (widget) {
    widget.style.display = "none";
  }
}

function toggleProfileWidget() {
  const widget = document.getElementById("profileWidget");
  if (widget) {
    if (widget.style.display === "none" || widget.style.display === "") {
      widget.style.display = "block";
    } else {
      widget.style.display = "none";
    }
  }
}

// Calculator functionality
function initCalculator(windowDiv) {
  const display = windowDiv.querySelector("#calc-display");
  const buttons = windowDiv.querySelectorAll(".calc-btn");

  let currentValue = "0";
  let previousValue = "";
  let operation = "";
  let shouldResetDisplay = false;

  const updateDisplay = () => {
    if (operation && previousValue) {
      display.innerHTML = `
        <div style="font-size: 14px; color: #94a3b8; margin-bottom: 4px;">${previousValue} ${operation}</div>
        <div style="font-size: 24px;">${currentValue}</div>
      `;
    } else {
      display.innerHTML = `<div style="font-size: 24px;">${currentValue}</div>`;
    }
  };

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = btn.dataset.value;

      if (value === "C") {
        currentValue = "0";
        previousValue = "";
        operation = "";
        shouldResetDisplay = false;
      } else if (value === "←") {
        currentValue =
          currentValue.length > 1 ? currentValue.slice(0, -1) : "0";
      } else if (["+", "-", "*", "/"].includes(value)) {
        if (operation && previousValue && !shouldResetDisplay) {
          const prev = parseFloat(previousValue);
          const curr = parseFloat(currentValue);
          switch (operation) {
            case "+":
              currentValue = String(prev + curr);
              break;
            case "-":
              currentValue = String(prev - curr);
              break;
            case "*":
              currentValue = String(prev * curr);
              break;
            case "/":
              currentValue = String(prev / curr);
              break;
          }
        }
        previousValue = currentValue;
        operation = value;
        shouldResetDisplay = true;
      } else if (value === "=") {
        if (operation && previousValue) {
          const prev = parseFloat(previousValue);
          const curr = parseFloat(currentValue);
          switch (operation) {
            case "+":
              currentValue = String(prev + curr);
              break;
            case "-":
              currentValue = String(prev - curr);
              break;
            case "*":
              currentValue = String(prev * curr);
              break;
            case "/":
              currentValue = String(prev / curr);
              break;
          }
          previousValue = "";
          operation = "";
        }
        shouldResetDisplay = true;
      } else if (value === ".") {
        if (!currentValue.includes(".")) {
          currentValue += ".";
        }
      } else {
        if (shouldResetDisplay || currentValue === "0") {
          currentValue = value;
          shouldResetDisplay = false;
        } else {
          currentValue += value;
        }
      }

      updateDisplay();
    });
  });
}

// Calendar functionality
function initCalendar(windowDiv) {
  const currentDate = new Date();
  let currentMonth = currentDate.getMonth();
  let currentYear = currentDate.getFullYear();

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const renderCalendar = () => {
    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const today = new Date();
    const isCurrentMonth =
      today.getMonth() === currentMonth && today.getFullYear() === currentYear;
    const todayDate = today.getDate();

    const calendarHTML = `
      <div style="padding: 20px; height: 100%; display: flex; flex-direction: column;">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
          <i class="fa-regular fa-calendar" style="font-size: 24px; color: #ff9800;"></i>
          <h2 style="margin: 0;">Calendar</h2>
        </div>
        <div style="flex: 1; background: rgba(255,255,255,0.03); border-radius: 12px; padding: 16px; backdrop-filter: blur(16px);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <button id="cal-prev" style="padding: 8px 12px; border-radius: 8px; background: rgba(255,255,255,0.1); border: none; color: #e2e8f0; cursor: pointer;">
              <i class="fa-solid fa-chevron-left"></i>
            </button>
            <h3 style="margin: 0; color: #e2e8f0; font-size: 20px;">${
              monthNames[currentMonth]
            } ${currentYear}</h3>
            <button id="cal-next" style="padding: 8px 12px; border-radius: 8px; background: rgba(255,255,255,0.1); border: none; color: #e2e8f0; cursor: pointer;">
              <i class="fa-solid fa-chevron-right"></i>
            </button>
          </div>
          <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px;">
            <div style="padding: 8px; text-align: center; color: #94a3b8; font-weight: 600; font-size: 12px;">Sun</div>
            <div style="padding: 8px; text-align: center; color: #94a3b8; font-weight: 600; font-size: 12px;">Mon</div>
            <div style="padding: 8px; text-align: center; color: #94a3b8; font-weight: 600; font-size: 12px;">Tue</div>
            <div style="padding: 8px; text-align: center; color: #94a3b8; font-weight: 600; font-size: 12px;">Wed</div>
            <div style="padding: 8px; text-align: center; color: #94a3b8; font-weight: 600; font-size: 12px;">Thu</div>
            <div style="padding: 8px; text-align: center; color: #94a3b8; font-weight: 600; font-size: 12px;">Fri</div>
            <div style="padding: 8px; text-align: center; color: #94a3b8; font-weight: 600; font-size: 12px;">Sat</div>
            ${Array.from({ length: firstDay }, () => "<div></div>").join("")}
            ${Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const isToday = isCurrentMonth && day === todayDate;
              return `<div style="padding: 12px 8px; text-align: center; color: #e2e8f0; cursor: pointer; border-radius: 8px; transition: all 0.2s; ${
                isToday
                  ? "background: linear-gradient(135deg, #38bdf8, #0ea5e9); font-weight: 700; box-shadow: 0 4px 12px rgba(56,189,248,0.4);"
                  : "background: rgba(255,255,255,0.05); hover:background: rgba(255,255,255,0.1);"
              }" onmouseover="this.style.background='rgba(56,189,248,0.2)'" onmouseout="this.style.background='${
                isToday
                  ? "linear-gradient(135deg, #38bdf8, #0ea5e9)"
                  : "rgba(255,255,255,0.05)"
              }'">${day}</div>`;
            }).join("")}
          </div>
        </div>
      </div>
    `;

    windowDiv.querySelector(".window-content").innerHTML = calendarHTML;

    windowDiv.querySelector("#cal-prev").addEventListener("click", () => {
      currentMonth--;
      if (currentMonth < 0) {
        currentMonth = 11;
        currentYear--;
      }
      renderCalendar();
    });

    windowDiv.querySelector("#cal-next").addEventListener("click", () => {
      currentMonth++;
      if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
      }
      renderCalendar();
    });
  };

  renderCalendar();
}

// Browser functionality
function initBrowser(windowDiv) {
  const urlInput = windowDiv.querySelector("#browser-url");
  const iframe = windowDiv.querySelector("#browser-frame");
  const goBtn = windowDiv.querySelector("#browser-go");
  const refreshBtn = windowDiv.querySelector("#browser-refresh");
  const backBtn = windowDiv.querySelector("#browser-back");
  const forwardBtn = windowDiv.querySelector("#browser-forward");

  goBtn.addEventListener("click", () => {
    let url = urlInput.value.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }
    iframe.src = url;
    urlInput.value = url;
  });

  urlInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      goBtn.click();
    }
  });

  refreshBtn.addEventListener("click", () => {
    iframe.src = iframe.src;
  });

  backBtn.addEventListener("click", () => {
    iframe.contentWindow.history.back();
  });

  forwardBtn.addEventListener("click", () => {
    iframe.contentWindow.history.forward();
  });
}

// Testimonials functionality
async function initTestimonials(windowDiv) {
  const loadTestimonials = async () => {
    try {
      const testimonialsRef = collection(window.firebaseDb, "testimonials");
      const q = query(testimonialsRef, orderBy("createdAt", "desc"));
      const snapshot = await getDocs(q);

      const testimonials = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      const testimonialsHTML = `
        <div style="padding: 20px; height: 100%; overflow-y: auto;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h2><i class="fa-solid fa-people-group"></i> Testimonials</h2>
            <button id="add-testimonial-btn" style="padding: 8px 16px; border-radius: 8px; background: #38bdf8; border: none; color: white; cursor: pointer; font-weight: 500;">
              <i class="fa-solid fa-plus"></i> Add Comment
            </button>
          </div>
          
          <div id="testimonial-form" style="display: none; margin-bottom: 24px; padding: 20px; background: rgba(255,255,255,0.05); border-radius: 12px;">
            <h3 style="margin: 0 0 16px 0; color: #e2e8f0;">Share Your Experience</h3>
            <input type="text" id="testimonial-name" placeholder="Your Name" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); color: #e2e8f0; margin-bottom: 12px;">
            <input type="text" id="testimonial-role" placeholder="Your Role/Company (optional)" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); color: #e2e8f0; margin-bottom: 12px;">
            <textarea id="testimonial-text" placeholder="Your testimonial..." style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); color: #e2e8f0; min-height: 100px; margin-bottom: 12px; font-family: inherit;"></textarea>
            <div style="display: flex; gap: 8px;">
              <button id="submit-testimonial" style="padding: 8px 16px; border-radius: 8px; background: #10b981; border: none; color: white; cursor: pointer; font-weight: 500;">Submit</button>
              <button id="cancel-testimonial" style="padding: 8px 16px; border-radius: 8px; background: rgba(255,255,255,0.1); border: none; color: #e2e8f0; cursor: pointer;">Cancel</button>
            </div>
          </div>
          
          <div id="testimonials-list" style="display: grid; gap: 16px;">
            ${
              testimonials.length === 0
                ? '<p style="color: #94a3b8; text-align: center; padding: 40px;">No testimonials yet. Be the first to share!</p>'
                : testimonials
                    .map(
                      (t) => `
                <div style="padding: 20px; border-radius: 12px; background: rgba(255,255,255,0.04); border-left: 3px solid #38bdf8; backdrop-filter: blur(16px);">
                  <p style="font-style: italic; margin-bottom: 12px; color: #e2e8f0; line-height: 1.6;">"${escapeHtml(
                    t.text
                  )}"</p>
                  <p style="font-size: 14px; color: #94a3b8; margin: 0;">
                    <strong style="color: #38bdf8;">${escapeHtml(
                      t.name
                    )}</strong>
                    ${t.role ? ` - ${escapeHtml(t.role)}` : ""}
                  </p>
                  ${
                    t.createdAt
                      ? `<p style="font-size: 12px; color: #64748b; margin: 4px 0 0 0;">${t.createdAt
                          .toDate()
                          .toLocaleDateString()}</p>`
                      : ""
                  }
                </div>
              `
                    )
                    .join("")
            }
          </div>
        </div>
      `;

      windowDiv.querySelector(".window-content").innerHTML = testimonialsHTML;

      // Add testimonial form toggle
      const addBtn = windowDiv.querySelector("#add-testimonial-btn");
      const form = windowDiv.querySelector("#testimonial-form");
      const cancelBtn = windowDiv.querySelector("#cancel-testimonial");
      const submitBtn = windowDiv.querySelector("#submit-testimonial");

      addBtn.addEventListener("click", () => {
        form.style.display = form.style.display === "none" ? "block" : "none";
      });

      cancelBtn.addEventListener("click", () => {
        form.style.display = "none";
        windowDiv.querySelector("#testimonial-name").value = "";
        windowDiv.querySelector("#testimonial-role").value = "";
        windowDiv.querySelector("#testimonial-text").value = "";
      });

      submitBtn.addEventListener("click", async () => {
        const name = windowDiv.querySelector("#testimonial-name").value.trim();
        const role = windowDiv.querySelector("#testimonial-role").value.trim();
        const text = windowDiv.querySelector("#testimonial-text").value.trim();

        if (!name || !text) {
          alert("Please fill in your name and testimonial.");
          return;
        }

        try {
          const testimonialsRef = collection(window.firebaseDb, "testimonials");
          await setDoc(doc(testimonialsRef), {
            name,
            role,
            text,
            createdAt: new Date(),
            approved: false,
          });

          alert(
            "Thank you! Your testimonial has been submitted and is awaiting approval."
          );
          form.style.display = "none";
          windowDiv.querySelector("#testimonial-name").value = "";
          windowDiv.querySelector("#testimonial-role").value = "";
          windowDiv.querySelector("#testimonial-text").value = "";
          loadTestimonials();
        } catch (error) {
          console.error("Error submitting testimonial:", error);
          alert("Failed to submit testimonial. Please try again.");
        }
      });
    } catch (error) {
      console.error("Error loading testimonials:", error);
      windowDiv.querySelector(".window-content").innerHTML = `
        <div style="padding: 20px;">
          <h2><i class="fa-solid fa-people-group"></i> Testimonials</h2>
          <p style="color: #ef4444;">Error loading testimonials. Please try again later.</p>
        </div>
      `;
    }
  };

  if (!window.firebaseDb) {
    windowDiv.querySelector(".window-content").innerHTML = `
      <div style="padding: 20px;">
        <h2><i class="fa-solid fa-people-group"></i> Testimonials</h2>
        <p style="color: #ef4444;">Please sign in to view and add testimonials.</p>
      </div>
    `;
    return;
  }

  loadTestimonials();
}

// Mail functionality
function initMail(windowDiv) {
  const composeBtn = windowDiv.querySelector("#compose-email-btn");
  const mailContent = windowDiv.querySelector("#mail-content");

  composeBtn.addEventListener("click", () => {
    mailContent.innerHTML = `
      <div style="padding: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <h3 style="margin: 0; color: #e2e8f0;"><i class="fa-solid fa-pen"></i> Compose Email</h3>
          <button id="close-compose" style="padding: 6px 10px; border-radius: 6px; background: rgba(255,255,255,0.1); border: none; color: #94a3b8; cursor: pointer;">
            <i class="fa-solid fa-times"></i>
          </button>
        </div>
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <div>
            <label style="display: block; margin-bottom: 4px; color: #94a3b8; font-size: 14px;">To:</label>
            <input type="email" id="mail-to" value="stevejupiter4@gmail.com" readonly style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); color: #e2e8f0;">
          </div>
          <div>
            <label style="display: block; margin-bottom: 4px; color: #94a3b8; font-size: 14px;">From:</label>
            <input type="email" id="mail-from" placeholder="your.email@example.com" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); color: #e2e8f0;">
          </div>
          <div>
            <label style="display: block; margin-bottom: 4px; color: #94a3b8; font-size: 14px;">Subject:</label>
            <input type="text" id="mail-subject" placeholder="Enter subject..." style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); color: #e2e8f0;">
          </div>
          <div>
            <label style="display: block; margin-bottom: 4px; color: #94a3b8; font-size: 14px;">Message:</label>
            <textarea id="mail-message" placeholder="Write your message..." style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); color: #e2e8f0; min-height: 200px; font-family: inherit; resize: vertical;"></textarea>
          </div>
          <div style="display: flex; gap: 8px; justify-content: flex-end;">
            <button id="send-email" style="padding: 10px 20px; border-radius: 8px; background: #3f51b5; border: none; color: white; cursor: pointer; font-weight: 500;">
              <i class="fa-solid fa-paper-plane" style="margin-right: 8px;"></i>Send Email
            </button>
          </div>
        </div>
      </div>
    `;

    const closeBtn = mailContent.querySelector("#close-compose");
    const sendBtn = mailContent.querySelector("#send-email");

    closeBtn.addEventListener("click", () => {
      mailContent.innerHTML = `
        <div style="border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 12px; margin-bottom: 16px;">
          <h3 style="margin: 0; color: #e2e8f0;">Welcome to AOS Mail</h3>
          <p style="margin: 4px 0 0 0; color: #94a3b8; font-size: 14px;">stevejupiter4@gmail.com</p>
        </div>
        <div style="text-align: center; padding: 40px;">
          <i class="fa-regular fa-envelope-open" style="font-size: 48px; color: #94a3b8; margin-bottom: 16px;"></i>
          <p style="color: #94a3b8;">Select "Compose" to send an email to Stephen.</p>
        </div>
      `;
    });

    sendBtn.addEventListener("click", () => {
      const from = mailContent.querySelector("#mail-from").value.trim();
      const subject = mailContent.querySelector("#mail-subject").value.trim();
      const message = mailContent.querySelector("#mail-message").value.trim();

      if (!from) {
        alert("Please enter your email address.");
        return;
      }

      if (!subject) {
        alert("Please enter a subject.");
        return;
      }

      if (!message) {
        alert("Please enter a message.");
        return;
      }

      // Create mailto link
      const mailtoLink = `mailto:stevejupiter4@gmail.com?subject=${encodeURIComponent(
        subject
      )}&body=${encodeURIComponent(`From: ${from}\n\n${message}`)}`;
      window.location.href = mailtoLink;

      mailContent.innerHTML = `
        <div style="text-align: center; padding: 60px 40px;">
          <div style="width: 80px; height: 80px; margin: 0 auto 20px; border-radius: 50%; background: rgba(16,185,129,0.2); display: flex; align-items: center; justify-content: center;">
            <i class="fa-solid fa-check" style="font-size: 40px; color: #10b981;"></i>
          </div>
          <h3 style="margin: 0 0 8px 0; color: #e2e8f0;">Email Client Opened</h3>
          <p style="margin: 0; color: #94a3b8;">Your default email client should now be open. If it didn't open automatically, please copy the email manually.</p>
          <button onclick="document.querySelector('#compose-email-btn').click()" style="margin-top: 20px; padding: 8px 16px; border-radius: 8px; background: #3f51b5; border: none; color: white; cursor: pointer;">
            Compose Another
          </button>
        </div>
      `;
    });
  });
}

// Settings functionality
function initSettings(windowDiv) {
  const settingsContent = windowDiv.querySelector("#settings-content");

  const renderSettings = () => {
    settingsContent.innerHTML = `
      <div style="padding: 16px; background: rgba(255,255,255,0.05); border-radius: 12px;">
        <h3 style="margin: 0 0 12px 0; color: #e2e8f0; display: flex; align-items: center; gap: 8px;">
          <i class="fa-solid fa-palette"></i>
          Appearance
        </h3>
        <div style="margin-bottom: 12px;">
          <label style="display: block; margin-bottom: 8px; color: #94a3b8; font-size: 14px;">Wallpaper</label>
          <button id="open-wallpaper-settings" style="padding: 10px 16px; border-radius: 8px; background: rgba(56,189,248,0.15); border: 1px solid #38bdf8; color: #38bdf8; cursor: pointer; font-weight: 500; width: 100%;">
            <i class="fa-solid fa-image" style="margin-right: 8px;"></i>
            Change Wallpaper
          </button>
        </div>
        <div>
          <label style="display: block; margin-bottom: 8px; color: #94a3b8; font-size: 14px;">Current: ${
            userPreferences.wallpaper
          }</label>
        </div>
      </div>
      
      <div style="padding: 16px; background: rgba(255,255,255,0.05); border-radius: 12px;">
        <h3 style="margin: 0 0 12px 0; color: #e2e8f0; display: flex; align-items: center; gap: 8px;">
          <i class="fa-solid fa-user"></i>
          Profile
        </h3>
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="width: 48px; height: 48px; border-radius: 50%; background: linear-gradient(135deg, #e91e63, #f06292); display: flex; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 20px; overflow: hidden;">
              ${
                currentUser?.photoURL
                  ? `<img src="${currentUser.photoURL}" style="width: 100%; height: 100%; object-fit: cover;">`
                  : currentUser?.displayName?.charAt(0) ||
                    currentUser?.email?.charAt(0) ||
                    "U"
              }
            </div>
            <div>
              <div style="color: #e2e8f0; font-weight: 600;">${
                currentUser?.displayName || currentUser?.email || "Guest User"
              }</div>
              <div style="color: #94a3b8; font-size: 14px;">${
                currentUser?.email || "Not signed in"
              }</div>
            </div>
          </div>
          ${
            !currentUser
              ? `
            <button id="settings-signin" style="padding: 10px 16px; border-radius: 8px; background: #10b981; border: none; color: white; cursor: pointer; font-weight: 500;">
              <i class="fa-solid fa-right-to-bracket" style="margin-right: 8px;"></i>
              Sign In
            </button>
          `
              : `
            <button id="settings-signout" style="padding: 10px 16px; border-radius: 8px; background: rgba(239,68,68,0.2); border: 1px solid #ef4444; color: #ef4444; cursor: pointer; font-weight: 500;">
              <i class="fa-solid fa-right-from-bracket" style="margin-right: 8px;"></i>
              Sign Out
            </button>
          `
          }
        </div>
      </div>
      
      <div style="padding: 16px; background: rgba(255,255,255,0.05); border-radius: 12px;">
        <h3 style="margin: 0 0 12px 0; color: #e2e8f0; display: flex; align-items: center; gap: 8px;">
          <i class="fa-solid fa-info-circle"></i>
          System Info
        </h3>
        <div style="display: flex; flex-direction: column; gap: 8px; color: #94a3b8; font-size: 14px;">
          <div style="display: flex; justify-content: space-between;">
            <span>Version:</span>
            <span style="color: #e2e8f0;">AOS 1.0.0</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span>Build:</span>
            <span style="color: #e2e8f0;">2025.12.06</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span>Browser:</span>
            <span style="color: #e2e8f0;">${navigator.userAgent
              .split(" ")
              .pop()}</span>
          </div>
        </div>
      </div>
      
      <div style="padding: 16px; background: rgba(255,255,255,0.05); border-radius: 12px;">
        <h3 style="margin: 0 0 12px 0; color: #e2e8f0; display: flex; align-items: center; gap: 8px;">
          <i class="fa-solid fa-keyboard"></i>
          Storage
        </h3>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <button id="clear-cache" style="padding: 10px 16px; border-radius: 8px; background: rgba(249,115,22,0.2); border: 1px solid #f97316; color: #f97316; cursor: pointer; font-weight: 500;">
            <i class="fa-solid fa-trash" style="margin-right: 8px;"></i>
            Clear Cache
          </button>
        </div>
      </div>
    `;

    const wallpaperBtn = settingsContent.querySelector(
      "#open-wallpaper-settings"
    );
    if (wallpaperBtn) {
      wallpaperBtn.addEventListener("click", () => {
        document.getElementById("wallpaperModal").classList.remove("hidden");
      });
    }

    const signoutBtn = settingsContent.querySelector("#settings-signout");
    if (signoutBtn) {
      signoutBtn.addEventListener("click", async () => {
        if (confirm("Are you sure you want to sign out?")) {
          await signOutUser();
        }
      });
    }

    const signinBtn = settingsContent.querySelector("#settings-signin");
    if (signinBtn) {
      signinBtn.addEventListener("click", () => {
        signInWithGoogle();
      });
    }

    const clearCacheBtn = settingsContent.querySelector("#clear-cache");
    if (clearCacheBtn) {
      clearCacheBtn.addEventListener("click", () => {
        if (
          confirm(
            "Clear browser cache and local storage? This will refresh the page."
          )
        ) {
          localStorage.clear();
          location.reload();
        }
      });
    }
  };

  renderSettings();
}

// Gift Creator Functions
async function loadReceivedGifts() {
  const giftsList = document.getElementById("received-gifts-list");
  if (!giftsList) return;

  giftsList.innerHTML =
    '<p style="color: #94a3b8; text-align: center;"><i class="fa-solid fa-spinner fa-spin"></i> Loading gifts...</p>';

  try {
    const response = await fetch(
      "https://tetgyhnqikauxjlrseiz.supabase.co/rest/v1/gift_orders?recipient_email=eq.stevejupiter4@gmail.com&payment_verified=eq.true&order=created_at.desc",
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          apikey:
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRldGd5aG5xaWthdXhqbHJzZWl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5NzQzNTcsImV4cCI6MjA4MDU1MDM1N30.pXn0IBCfI9_A182qoYfN36L0g9PXuABD1wCjaOpU18M",
        },
      }
    );

    if (!response.ok) {
      throw new Error("Failed to load gifts");
    }

    const gifts = await response.json();

    if (gifts.length === 0) {
      giftsList.innerHTML =
        '<p style="color: #94a3b8; text-align: center;"><i class="fa-solid fa-gift"></i> No gifts received yet.</p>';
      return;
    }

    const giftCards = gifts
      .map((gift) => {
        const createdDate = new Date(gift.created_at).toLocaleDateString();
        const giftTypeIcon =
          {
            birthday: "fa-birthday-cake",
            anniversary: "fa-heart",
            "thank-you": "fa-handshake",
            congratulations: "fa-trophy",
            "just-because": "fa-smile",
          }[gift.gift_type] || "fa-gift";

        return `
        <div style="padding: 16px; border-radius: 8px; background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.3);">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <i class="fa-solid ${giftTypeIcon}" style="color: #10b981;"></i>
              <span style="color: #e2e8f0; font-weight: 500; text-transform: capitalize;">${gift.gift_type.replace(
                "-",
                " "
              )} Gift</span>
            </div>
            <span style="color: #94a3b8; font-size: 12px;">${createdDate}</span>
          </div>
          <div style="margin-bottom: 8px;">
            <p style="margin: 0; color: #e2e8f0; font-weight: 500;">From: ${
              gift.sender_name
            }</p>
            <p style="margin: 4px 0 0 0; color: #94a3b8; font-size: 14px;">${
              gift.sender_email
            }</p>
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span style="color: #10b981; font-weight: 600;">GHS ${
              gift.gift_amount
            }</span>
            ${
              gift.message
                ? `<span style="color: #94a3b8; font-size: 12px; font-style: italic;">"${gift.message}"</span>`
                : ""
            }
          </div>
        </div>
      `;
      })
      .join("");

    giftsList.innerHTML = giftCards;
  } catch (error) {
    console.error("Error loading gifts:", error);
    giftsList.innerHTML =
      '<p style="color: #ef4444; text-align: center;"><i class="fa-solid fa-exclamation-triangle"></i> Failed to load gifts.</p>';
  }
}

function initGiftCreator(windowDiv) {
  const form = windowDiv.querySelector("#gift-creator-form");
  const statusDiv = windowDiv.querySelector("#gift-status");
  const senderNameInput = document.getElementById("gift-sender-name");
  const senderEmailInput = document.getElementById("gift-sender-email");
  const receivedGiftsSection = document.getElementById(
    "received-gifts-section"
  );

  // Show received gifts section if user is Stephen J.
  if (currentUser && currentUser.email === "stevejupiter4@gmail.com") {
    receivedGiftsSection.style.display = "block";
    loadReceivedGifts();
  } else {
    receivedGiftsSection.style.display = "none";
  }

  // Populate sender info from auth
  if (currentUser) {
    senderNameInput.value =
      currentUser.displayName ||
      currentUser.email?.split("@")[0] ||
      "Anonymous";
    senderEmailInput.value = currentUser.email || "";
  } else {
    statusDiv.innerHTML =
      '<p style="color: #ef4444;">Please sign in to send a gift.</p>';
    return;
  }

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const senderName = senderNameInput.value;
      const senderEmail = senderEmailInput.value;
      const recipientName = "Stephen J.";
      const recipientEmail = "stevejupiter4@gmail.com";
      const giftType = document.getElementById("gift-type").value;
      const giftAmount = parseFloat(
        document.getElementById("gift-amount").value
      );
      const message = document.getElementById("gift-message").value;

      statusDiv.innerHTML =
        '<p style="color: #3b82f6;">Creating gift order...</p>';

      try {
        // Create gift order
        const createResponse = await fetch(
          "https://tetgyhnqikauxjlrseiz.supabase.co/functions/v1/aos-services/create-gift",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization:
                "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRldGd5aG5xaWthdXhqbHJzZWl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5NzQzNTcsImV4cCI6MjA4MDU1MDM1N30.pXn0IBCfI9_A182qoYfN36L0g9PXuABD1wCjaOpU18M",
            },
            body: JSON.stringify({
              sender_name: senderName,
              sender_email: senderEmail,
              recipient_name: recipientName,
              recipient_email: recipientEmail,
              gift_type: giftType,
              gift_amount: giftAmount,
              message: message,
            }),
          }
        );

        if (!createResponse.ok) {
          throw new Error("Failed to create gift order");
        }

        const createResult = await createResponse.json();
        const orderReference = createResult.order.id;

        // Initialize Paystack
        const handler = PaystackPop.setup({
          key: "pk_live_c00c0b9c3267aab757f0644a027e4ad0e5079b41", // Replace with your actual Paystack public key
          email: senderEmail,
          amount: giftAmount * 100, // Convert to pesewas
          currency: "GHS",
          ref: `GIFT-${orderReference}-${Date.now()}`,
          metadata: {
            order_id: orderReference,
            gift_type: giftType,
            recipient_name: recipientName,
          },
          callback: function (response) {
            statusDiv.innerHTML =
              '<p style="color: #10b981;">Payment successful! Verifying...</p>';

            // Verify payment
            fetch(
              "https://tetgyhnqikauxjlrseiz.supabase.co/functions/v1/aos-services/verify-payment",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization:
                    "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRldGd5aG5xaWthdXhqbHJzZWl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5NzQzNTcsImV4cCI6MjA4MDU1MDM1N30.pXn0IBCfI9_A182qoYfN36L0g9PXuABD1wCjaOpU18M",
                },
                body: JSON.stringify({ reference: response.reference }),
              }
            )
              .then((res) => res.json())
              .then((verifyResult) => {
                if (verifyResult.verified) {
                  statusDiv.innerHTML = `
                    <div style="padding: 16px; border-radius: 8px; background: rgba(16,185,129,0.2); border: 1px solid #10b981;">
                      <h3 style="margin: 0 0 8px 0; color: #10b981;">
                        <i class="fa-solid fa-check-circle"></i> Gift Sent Successfully!
                      </h3>
                      <p style="margin: 0; color: #e2e8f0;">Your gift has been sent to ${recipientName}. They will receive an email notification shortly.</p>
                    </div>
                  `;
                  form.reset();
                } else {
                  statusDiv.innerHTML =
                    '<p style="color: #ef4444;">Payment verification failed</p>';
                }
              })
              .catch((error) => {
                console.error("Verification error:", error);
                statusDiv.innerHTML = `<p style="color: #ef4444;">Verification error: ${error.message}</p>`;
              });
          },
          onClose: function () {
            statusDiv.innerHTML =
              '<p style="color: #ef4444;">Payment cancelled</p>';
          },
        });

        handler.openIframe();
      } catch (error) {
        console.error("Gift creation error:", error);
        statusDiv.innerHTML = `<p style="color: #ef4444;">Error: ${error.message}</p>`;
      }
    });
  }
}

// Media upload functions
async function uploadFileToSupabase(file, bucket) {
  if (!window.supabaseClient?.storage) {
    throw new Error("Supabase storage client not available");
  }

  const fileExt = file.name.split(".").pop()?.toLowerCase() || "file";
  const uniqueSuffix =
    Date.now() + "-" + Math.random().toString(36).slice(2, 10);
  const filePath = `${currentUser.uid}/${uniqueSuffix}.${fileExt}`;

  const { data, error } = await window.supabaseClient.storage
    .from(bucket)
    .upload(filePath, file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (error) throw error;

  const { data: publicUrlData, error: publicUrlError } =
    window.supabaseClient.storage.from(bucket).getPublicUrl(filePath);

  if (publicUrlError) throw publicUrlError;

  return {
    path: data.path,
    publicUrl: publicUrlData.publicUrl,
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
  };
}

async function saveFileMetadata(collectionName, fileData) {
  if (!window.firebaseDb || !currentUser) return;

  const docRef = window.doc(
    window.collection(window.firebaseDb, collectionName)
  );
  await setDoc(docRef, {
    ...fileData,
    userId: currentUser.uid,
    uploadedAt: new Date(),
  });
}

async function deleteFile(collectionName, docId, filePath) {
  if (!window.firebaseDb || !window.supabaseClient?.storage) return;

  try {
    // Delete from Supabase storage
    const { error: storageError } = await window.supabaseClient.storage
      .from("project-images")
      .remove([filePath]);

    if (storageError) {
      console.error("Storage delete error:", storageError);
      throw storageError;
    }

    // Delete from Firestore
    const docRef = window.doc(
      window.collection(window.firebaseDb, collectionName),
      docId
    );
    await window.updateDoc(docRef, { deleted: true, deletedAt: new Date() });

    console.log("File deleted successfully");
  } catch (error) {
    console.error("Delete error:", error);
    alert(`Failed to delete file: ${error.message}`);
  }
}

// Make deleteFile global
window.deleteFile = deleteFile;

async function loadUserFiles(collectionName, containerId, renderFunction) {
  const container = document.getElementById(containerId);
  if (!container || !window.firebaseDb || !currentUser) return;

  container.innerHTML = '<p style="color: #94a3b8;">Loading...</p>';

  try {
    const filesRef = window.collection(window.firebaseDb, collectionName);
    const q = query(filesRef);
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      container.innerHTML =
        '<p style="color: #94a3b8;">No files uploaded yet.</p>';
      return;
    }

    const files = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((file) => !file.deleted)
      .sort((a, b) => {
        const aTime = a.uploadedAt?.toDate?.() || new Date(a.uploadedAt);
        const bTime = b.uploadedAt?.toDate?.() || new Date(b.uploadedAt);
        return bTime - aTime; // Descending order
      });
    renderFunction(container, files);
  } catch (error) {
    console.error(`Error loading ${collectionName}:`, error);
    container.innerHTML = `<p style="color: #ef4444;">Error loading files: ${error.message}</p>`;
  }
}

// Pictures functions
function initPictures(windowDiv) {
  loadUserFiles("user_pictures", "pictures-grid", renderPictures);

  const uploadBtn = windowDiv.querySelector("#upload-picture-btn");
  const fileInput = windowDiv.querySelector("#picture-upload");
  const refreshBtn = windowDiv.querySelector("#refresh-pictures-btn");

  if (currentUser?.email === "stevejupiter4@gmail.com") {
    uploadBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) =>
      handlePictureUpload(e.target.files)
    );
  } else {
    uploadBtn.style.display = "none";
  }
  refreshBtn.addEventListener("click", () =>
    loadUserFiles("user_pictures", "pictures-grid", renderPictures)
  );
}

async function handlePictureUpload(files) {
  if (!files.length) return;

  for (const file of files) {
    try {
      const uploaded = await uploadFileToSupabase(file, "project-images");
      await saveFileMetadata("user_pictures", uploaded);
    } catch (error) {
      console.error("Upload error:", error);
      alert(`Failed to upload ${file.name}: ${error.message}`);
    }
  }

  loadUserFiles("user_pictures", "pictures-grid", renderPictures);
}

function renderPictures(container, files) {
  const isAdmin = currentUser?.email === "stevejupiter4@gmail.com";
  container.innerHTML = files
    .map(
      (file) => `
    <div style="background: rgba(255,255,255,0.05); border-radius: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1); position: relative;">
      <img src="${file.publicUrl}" alt="${
        file.fileName
      }" style="width: 100%; height: 120px; object-fit: cover;">
      <div style="padding: 8px;">
        <p style="margin: 0; color: #e2e8f0; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${
          file.fileName
        }</p>
        <p style="margin: 4px 0 0 0; color: #94a3b8; font-size: 10px;">${(
          file.fileSize / 1024
        ).toFixed(1)} KB</p>
      </div>
      ${
        isAdmin
          ? `<button onclick="deleteFile('user_pictures', '${file.id}', '${file.path}'); loadUserFiles('user_pictures', 'pictures-grid', renderPictures);" style="position: absolute; top: 8px; right: 8px; background: rgba(239,68,68,0.8); border: none; border-radius: 50%; width: 24px; height: 24px; color: white; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 12px;"><i class="fa-solid fa-trash"></i></button>`
          : ""
      }
    </div>
  `
    )
    .join("");
}

// Music functions
function initMusic(windowDiv) {
  loadUserFiles("user_music", "music-list", renderMusic);

  const uploadBtn = windowDiv.querySelector("#upload-music-btn");
  const fileInput = windowDiv.querySelector("#music-upload");
  const refreshBtn = windowDiv.querySelector("#refresh-music-btn");

  if (currentUser?.email === "stevejupiter4@gmail.com") {
    uploadBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) =>
      handleMusicUpload(e.target.files)
    );
  } else {
    uploadBtn.style.display = "none";
  }
  refreshBtn.addEventListener("click", () =>
    loadUserFiles("user_music", "music-list", renderMusic)
  );
}

async function handleMusicUpload(files) {
  if (!files.length) return;

  for (const file of files) {
    try {
      const uploaded = await uploadFileToSupabase(file, "project-images");
      await saveFileMetadata("user_music", uploaded);
    } catch (error) {
      console.error("Upload error:", error);
      alert(`Failed to upload ${file.name}: ${error.message}`);
    }
  }

  loadUserFiles("user_music", "music-list", renderMusic);
}

function renderMusic(container, files) {
  const isAdmin = currentUser?.email === "stevejupiter4@gmail.com";
  container.innerHTML = files
    .map(
      (file) => `
    <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); position: relative;">
      <i class="fa-solid fa-music" style="font-size: 24px; color: #38bdf8;"></i>
      <div style="flex: 1;">
        <p style="margin: 0; color: #e2e8f0; font-weight: 500;">${
          file.fileName
        }</p>
        <p style="margin: 2px 0 0 0; color: #94a3b8; font-size: 12px;">${(
          file.fileSize /
          1024 /
          1024
        ).toFixed(1)} MB</p>
      </div>
      <audio controls style="flex-shrink: 0;">
        <source src="${file.publicUrl}" type="${file.fileType}">
      </audio>
      ${
        isAdmin
          ? `<button onclick="deleteFile('user_music', '${file.id}', '${file.path}'); loadUserFiles('user_music', 'music-list', renderMusic);" style="position: absolute; top: 8px; right: 8px; background: rgba(239,68,68,0.8); border: none; border-radius: 50%; width: 24px; height: 24px; color: white; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 12px;"><i class="fa-solid fa-trash"></i></button>`
          : ""
      }
    </div>
  `
    )
    .join("");
}

// Videos functions
function initVideos(windowDiv) {
  loadUserFiles("user_videos", "videos-grid", renderVideos);

  const uploadBtn = windowDiv.querySelector("#upload-video-btn");
  const fileInput = windowDiv.querySelector("#video-upload");
  const refreshBtn = windowDiv.querySelector("#refresh-videos-btn");

  if (currentUser?.email === "stevejupiter4@gmail.com") {
    uploadBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) =>
      handleVideoUpload(e.target.files)
    );
  } else {
    uploadBtn.style.display = "none";
  }
  refreshBtn.addEventListener("click", () =>
    loadUserFiles("user_videos", "videos-grid", renderVideos)
  );
}

async function handleVideoUpload(files) {
  if (!files.length) return;

  for (const file of files) {
    try {
      const uploaded = await uploadFileToSupabase(file, "project-images");
      await saveFileMetadata("user_videos", uploaded);
    } catch (error) {
      console.error("Upload error:", error);
      alert(`Failed to upload ${file.name}: ${error.message}`);
    }
  }

  loadUserFiles("user_videos", "videos-grid", renderVideos);
}

function renderVideos(container, files) {
  const isAdmin = currentUser?.email === "stevejupiter4@gmail.com";
  container.innerHTML = files
    .map(
      (file) => `
    <div style="background: rgba(255,255,255,0.05); border-radius: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1); position: relative;">
      <video style="width: 100%; height: 120px; object-fit: cover;" controls>
        <source src="${file.publicUrl}" type="${file.fileType}">
      </video>
      <div style="padding: 8px;">
        <p style="margin: 0; color: #e2e8f0; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${
          file.fileName
        }</p>
        <p style="margin: 4px 0 0 0; color: #94a3b8; font-size: 10px;">${(
          file.fileSize /
          1024 /
          1024
        ).toFixed(1)} MB</p>
      </div>
      ${
        isAdmin
          ? `<button onclick="deleteFile('user_videos', '${file.id}', '${file.path}'); loadUserFiles('user_videos', 'videos-grid', renderVideos);" style="position: absolute; top: 8px; right: 8px; background: rgba(239,68,68,0.8); border: none; border-radius: 50%; width: 24px; height: 24px; color: white; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 12px;"><i class="fa-solid fa-trash"></i></button>`
          : ""
      }
    </div>
  `
    )
    .join("");
}

// Documents functions
function initDocuments(windowDiv) {
  loadUserFiles("user_documents", "documents-list", renderDocuments);

  const uploadBtn = windowDiv.querySelector("#upload-document-btn");
  const fileInput = windowDiv.querySelector("#document-upload");
  const refreshBtn = windowDiv.querySelector("#refresh-documents-btn");

  if (currentUser?.email === "stevejupiter4@gmail.com") {
    uploadBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) =>
      handleDocumentUpload(e.target.files)
    );
  } else {
    uploadBtn.style.display = "none";
  }
  refreshBtn.addEventListener("click", () =>
    loadUserFiles("user_documents", "documents-list", renderDocuments)
  );
}

async function handleDocumentUpload(files) {
  if (!files.length) return;

  for (const file of files) {
    try {
      const uploaded = await uploadFileToSupabase(file, "project-images");
      await saveFileMetadata("user_documents", uploaded);
    } catch (error) {
      console.error("Upload error:", error);
      alert(`Failed to upload ${file.name}: ${error.message}`);
    }
  }

  loadUserFiles("user_documents", "documents-list", renderDocuments);
}

function renderDocuments(container, files) {
  const isAdmin = currentUser?.email === "stevejupiter4@gmail.com";
  container.innerHTML = files
    .map(
      (file) => `
    <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); position: relative;">
      <i class="fa-regular fa-file-lines" style="font-size: 24px; color: #f59e0b;"></i>
      <div style="flex: 1;">
        <p style="margin: 0; color: #e2e8f0; font-weight: 500;">${
          file.fileName
        }</p>
        <p style="margin: 2px 0 0 0; color: #94a3b8; font-size: 12px;">${(
          file.fileSize / 1024
        ).toFixed(1)} KB • ${file.fileType}</p>
      </div>
      <a href="${
        file.publicUrl
      }" target="_blank" style="padding: 6px 12px; border-radius: 6px; background: #f59e0b; color: white; text-decoration: none; font-size: 12px;">
        <i class="fa-solid fa-download"></i> View
      </a>
      ${
        isAdmin
          ? `<button onclick="deleteFile('user_documents', '${file.id}', '${file.path}'); loadUserFiles('user_documents', 'documents-list', renderDocuments);" style="position: absolute; top: 8px; right: 8px; background: rgba(239,68,68,0.8); border: none; border-radius: 50%; width: 24px; height: 24px; color: white; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 12px;"><i class="fa-solid fa-trash"></i></button>`
          : ""
      }
    </div>
  `
    )
    .join("");
}

document.addEventListener("DOMContentLoaded", () => {
  window.bootStartTime = Date.now();
  init();
  initProfileWidget();
});

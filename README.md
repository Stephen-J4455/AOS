# AOS - Amuzu Operating System

A creative portfolio operating system interface built with HTML, CSS, and JavaScript, featuring Firebase integration for user authentication and Firestore database, with Supabase for file storage.

## Features

- **Desktop Interface**: Glassmorphism design with customizable wallpapers
- **Window Management**: Drag, minimize, maximize, and close windows
- **Start Menu**: Searchable app launcher with user profile
- **Terminal**: Windows Command Prompt-style interface with portfolio commands
- **Firebase Database Manager**: Browse and view Firestore collections and documents
- **Firebase + Supabase Integration**: User authentication, Firestore database operations, and Supabase file storage
- **Project Upload Pipeline**: Project images are uploaded to Supabase Storage and their signed download URLs are saved in Firestore alongside project metadata

## Firebase + Supabase Setup

To enable Firebase features (authentication, database) and Supabase features (storage), follow these steps:

### 1. Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Create a project" (or select existing)
3. Enable Google Analytics if desired
4. Complete project setup

### 2. Enable Authentication

1. In Firebase Console, go to **Authentication → Get started**
2. Go to **Sign-in method** tab
3. Enable **Google** provider
4. Add your domain to authorized domains (for production)

### 3. Set up Firestore Database

1. In Firebase Console, go to **Firestore Database**
2. Click "Create database"
3. Choose "Start in test mode" for development
4. Set up security rules (optional for basic functionality)

### 4. Get Your Firebase Config

1. In Firebase Console, go to **Project settings** (gear icon)
2. Scroll to "Your apps" section
3. Click "Add app" → Web app (</>)
4. Register your app with a nickname
5. Copy the config object

### 5. Update the Firebase Config

In `index.html`, replace the placeholder Firebase config with your actual config:

```javascript
// Firebase configuration - REPLACE WITH YOUR ACTUAL CONFIG
const firebaseConfig = {
  apiKey: "your-api-key",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456",
};
```

### 6. Set Up Supabase Storage

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Create a new project or use existing
3. Go to **Storage** in the sidebar
4. Create a new bucket called `project-images`
5. Set bucket to **public**
6. Configure RLS policies if needed

### 7. Get Supabase Config

1. In Supabase Dashboard, go to Settings → API
2. Copy the "Project URL" and "anon public" key
3. Update the Supabase config in `index.html`

### 4. Set Up Database Tables

Create the following tables in your Supabase database:

#### `user_preferences`

```sql
CREATE TABLE user_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  wallpaper TEXT DEFAULT 'aurora',
  theme TEXT DEFAULT 'dark',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);
```

#### `projects`

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  technology TEXT[] DEFAULT '{}',
  github TEXT,
  image_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### `updates`

```sql
CREATE TABLE updates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  published BOOLEAN DEFAULT TRUE
);
```

### 5. Set Up Storage

1. In Supabase Dashboard, go to Storage
2. Create a new bucket called `project-images`
3. Set bucket to public
4. Configure RLS policies for the bucket

### 6. Enable Authentication

1. In Supabase Dashboard, go to **Authentication → Providers**
2. Enable **Google** OAuth provider
3. You'll need Google OAuth credentials:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create/select a project
   - Enable Google+ API
   - Create OAuth 2.0 credentials
   - Add authorized redirect URIs: `https://tetgyhnqikauxjlrseiz.supabase.co/auth/v1/callback`
   - Copy Client ID and Client Secret to Supabase

### 7. Configure Site URL

In Supabase Dashboard → Authentication → Settings:

- **Site URL**: `http://localhost:8000` (for local development)
- **Redirect URLs**: Add your production domain when deploying

### 8. Test Authentication

1. Open browser console (F12)
2. Click "Sign in with Google"
3. Check console for debugging messages
4. If OAuth fails, check Supabase Auth logs

## Troubleshooting Authentication

### Common Issues:

1. **"OAuth provider not configured"**

   - Enable Google provider in Supabase Auth → Providers

2. **"Invalid redirect URL"**

   - Add your domain to Supabase Auth settings
   - For local development: `http://localhost:8000`

3. **"CORS error"**

   - Ensure your site URL is configured in Supabase

4. **"Auth session not persisting"**
   - Check browser cookies and localStorage
   - Ensure Supabase URL is correct

### Debug Steps:

1. Open browser Developer Tools (F12)
2. Go to Console tab
3. Click "Sign in with Google"
4. Look for error messages in red
5. Check Network tab for failed requests

## Admin Features

The admin user (stevejupiter4@gmail.com) has additional capabilities:

- Upload and manage projects with images
- Add portfolio updates
- Access to database management interface

## Running the Application

1. Clone the repository
2. Open `index.html` in a web browser
3. Sign in with Google to access the full OS interface

## Technologies Used

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Backend**: Supabase (PostgreSQL, Auth, Storage)
- **UI Framework**: Custom glassmorphism design
- **Icons**: Font Awesome 6
- **Fonts**: Space Grotesk

## Browser Support

- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

## License

This project is open source and available under the [MIT License](LICENSE). 3. Go to Sign-in method tab 4. Enable Google provider 5. Add your domain to authorized domains

### 5. Set up Firestore Database

1. In Firebase Console, go to Firestore Database
2. Click "Create database"
3. Choose "Start in test mode" for development
4. Set up security rules (optional for basic functionality)

## Firebase Features

- **Required Google Authentication**: Sign in with Google account to access the OS
- **User Preferences**: Wallpaper choices saved to Firestore
- **Persistent Sessions**: User state maintained across sessions
- **Database Management**: Browse collections and view documents
- **Secret Admin Panel**: Hidden admin controls for adding projects and updates (activated by clicking title 3 times)
- **Admin Upload Button**: Special "Upload Projects" button in start menu for admin user (stevejupiter4@gmail.com)

## Supabase Features

- **File Storage**: Project images stored in Supabase Storage
- **Public Access**: Images accessible via public URLs
- **Scalable Storage**: Cloud-based file hosting

## Usage

1. Open `index.html` in a web browser
2. **Sign in with your Google account** to access the operating system
3. Once authenticated, you'll see the full AOS interface:
   - Click the Start button to open the start menu
   - Double-click desktop icons to open applications
   - Use the terminal for portfolio commands (Windows CMD-style interface)
   - Access the **Firebase Database** app to browse your Firestore data
   - **Admin users** (stevejupiter4@gmail.com) see an "Upload Projects" button in the start menu for quick project management
   - Change wallpapers from the system tray

## Authentication Required

AOS requires Google authentication to access the operating system interface. This ensures that only authorized users can view your portfolio content and maintains user-specific preferences across sessions.

## File Structure

```
AOS/
├── index.html          # Main HTML file with Firebase + Supabase setup
├── styles.css          # CSS styles for the OS interface
├── script.js           # JavaScript for functionality and Firebase/Supabase integration
└── assets/
    └── AOS.jpg         # Logo image for branding
```

## Technologies Used

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Authentication & Database**: Firebase (Auth, Firestore)
- **File Storage**: Supabase Storage
- **UI Framework**: Custom glassmorphism design
- **Icons**: Font Awesome 6
- **Fonts**: Space Grotesk

## Browser Support

- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

## License

This project is open source and available under the [MIT License](LICENSE).

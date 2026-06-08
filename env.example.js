// ════════════════════════════════════════════════════════════════
// env.example.js — template for backend config.
//   1. Copy this file to  env.js   (env.js is gitignored).
//   2. Fill in your real Supabase project URL + anon key.
// This keeps credentials OUT of the public repo. Without env.js the app
// still loads, but on local fallback data only (no live backend).
// ════════════════════════════════════════════════════════════════
window.KAFEEL_ENV = {
  // Supabase → Settings → API
  SUPABASE_URL: 'https://YOUR_PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY',

  // Firebase (push notifications) — optional. Fill in when you set up FCM
  // and mirror the same values into sw.js.
  // FIREBASE_CONFIG: {
  //   apiKey: 'YOUR_FIREBASE_API_KEY',
  //   authDomain: 'YOUR_PROJECT.firebaseapp.com',
  //   projectId: 'YOUR_PROJECT',
  //   storageBucket: 'YOUR_PROJECT.firebasestorage.app',
  //   messagingSenderId: 'YOUR_SENDER_ID',
  //   appId: 'YOUR_APP_ID',
  // },
  // FCM_VAPID_KEY: 'YOUR_FCM_VAPID_KEY',
};

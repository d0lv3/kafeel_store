// ════════════════════════════════════════════════════════════════
// generate-env.js — writes env.js AND sw-config.js at BUILD TIME.
//
// Used by Vercel (see vercel.json `buildCommand`) so credentials reach
// the deployed site WITHOUT being committed to this public repo.
//
// Set these in Vercel → Project → Settings → Environment Variables:
//     SUPABASE_URL          = https://xxxx.supabase.co
//     SUPABASE_ANON_KEY     = eyJ...
//     FIREBASE_API_KEY      = AIza...
//     FIREBASE_AUTH_DOMAIN  = kafeel-market.firebaseapp.com
//     FIREBASE_PROJECT_ID   = kafeel-market
//     FIREBASE_STORAGE_BUCKET = kafeel-market.firebasestorage.app
//     FIREBASE_SENDER_ID    = 380579163487
//     FIREBASE_APP_ID       = 1:380579163487:web:...
//     FCM_VAPID_KEY         = BM-...
//
// Locally you don't run this — keep hand-written env.js + sw-config.js
// (both gitignored). As a safeguard, if no SUPABASE_URL is set and an
// env.js already exists, this script leaves both files untouched.
// ════════════════════════════════════════════════════════════════
const fs = require('fs');

// Trim values — pasting into the Vercel dashboard can pick up stray
// whitespace/tabs/newlines that would otherwise break the URL/key.
const clean = (v) => String(v || '').trim();

const env = {
  SUPABASE_URL: clean(process.env.SUPABASE_URL),
  SUPABASE_ANON_KEY: clean(process.env.SUPABASE_ANON_KEY),
};

if (clean(process.env.FIREBASE_API_KEY)) {
  env.FIREBASE_CONFIG = {
    apiKey: clean(process.env.FIREBASE_API_KEY),
    authDomain: clean(process.env.FIREBASE_AUTH_DOMAIN),
    projectId: clean(process.env.FIREBASE_PROJECT_ID),
    storageBucket: clean(process.env.FIREBASE_STORAGE_BUCKET),
    messagingSenderId: clean(process.env.FIREBASE_SENDER_ID),
    appId: clean(process.env.FIREBASE_APP_ID),
  };
}
if (clean(process.env.FCM_VAPID_KEY)) env.FCM_VAPID_KEY = clean(process.env.FCM_VAPID_KEY);

if (!env.SUPABASE_URL && fs.existsSync('env.js')) {
  console.warn('[generate-env] No SUPABASE_URL set — keeping existing env.js untouched.');
  process.exit(0);
}

const out =
  '// Generated at build time from environment variables. Do not edit.\n' +
  'window.KAFEEL_ENV = ' + JSON.stringify(env, null, 2) + ';\n';
fs.writeFileSync('env.js', out);

if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
  console.warn('[generate-env] WARNING: SUPABASE_URL / SUPABASE_ANON_KEY missing — ' +
               'the deployed site will use local fallback data (no live backend).');
} else {
  console.log('[generate-env] Wrote env.js with Supabase config from environment.');
}

// Also write sw-config.js — the service worker cannot read window.KAFEEL_ENV,
// so it gets the Firebase config via importScripts('sw-config.js') instead.
// sw-config.js is gitignored; it is generated here at build time alongside env.js.
const swOut =
  '// Generated at build time from environment variables. Do not edit.\n' +
  'self.KAFEEL_FIREBASE_CONFIG = ' + JSON.stringify(env.FIREBASE_CONFIG || null) + ';\n' +
  'self.KAFEEL_VAPID_KEY = ' + JSON.stringify(env.FCM_VAPID_KEY || '') + ';\n';
fs.writeFileSync('sw-config.js', swOut);
if (env.FIREBASE_CONFIG) {
  console.log('[generate-env] Wrote sw-config.js with Firebase config (push enabled).');
} else {
  console.warn('[generate-env] No Firebase config — push notifications will be disabled.');
}

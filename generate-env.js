// ════════════════════════════════════════════════════════════════
// generate-env.js — writes env.js at BUILD TIME from environment vars.
//
// Used by Vercel (see vercel.json `buildCommand`) so the Supabase config
// reaches the deployed site WITHOUT committing it to this public repo.
// Set these in Vercel → Project → Settings → Environment Variables:
//     SUPABASE_URL          = https://xxxx.supabase.co
//     SUPABASE_ANON_KEY     = eyJ...
// Optional (push notifications):
//     FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID,
//     FIREBASE_STORAGE_BUCKET, FIREBASE_SENDER_ID, FIREBASE_APP_ID,
//     FCM_VAPID_KEY
//
// Locally you don't run this — you keep a hand-written env.js (gitignored).
// As a safeguard, if no SUPABASE_URL is set and an env.js already exists,
// this script leaves it untouched (so it won't wipe your local config).
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

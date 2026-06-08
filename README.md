# ماركت الكفيل — Kafeel Market PWA

An Arabic (RTL) Progressive Web App for a grocery/market store — online ordering,
live order tracking, push notifications, and a secure admin dashboard. Vanilla
JS + Supabase (Postgres, RLS, realtime, Storage) + Firebase Cloud Messaging.

> Branch: **فرع العزيزية** · Theme: Kafeel green `#3CA043` · 2-products-per-row menu.

## Quick start

```bash
# 1. Configure the backend (keeps secrets out of git)
cp env.example.js env.js        # then paste your Supabase URL + anon key

# 2. Serve over HTTP (a service worker can't run from file://)
python -m http.server 8080
```

Open <http://localhost:8080/index.html> (customer) and
<http://localhost:8080/admin.html> (dashboard).

## Configuration & secrets

- **`env.js` is gitignored** and holds the real Supabase URL + anon key (and,
  later, Firebase config). Copy `env.example.js` → `env.js` and fill it in.
- No service-role keys or private keys live in the repo. The image-migration
  script reads them from environment variables (`SUPABASE_URL`,
  `SUPABASE_SERVICE_KEY`).
- Without `env.js` the app still loads, on local fallback data only.

## Deploying to Vercel

`env.js` is gitignored, so it isn't in the repo — instead it's **generated at
build time** from environment variables by `generate-env.js` (wired up in
`vercel.json`). In **Vercel → Project → Settings → Environment Variables** add:

| Name | Value |
|------|-------|
| `SUPABASE_URL` | `https://YOUR_PROJECT.supabase.co` |
| `SUPABASE_ANON_KEY` | your anon public key |

(Optional, for push: `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`,
`FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_SENDER_ID`,
`FIREBASE_APP_ID`, `FCM_VAPID_KEY`.)

Then redeploy. The build writes `env.js`, Supabase connects, and product/section
photos load from Storage. Without these vars the site falls back to local sample
data (and bundled images aren't shipped, so photos would be missing) — that's the
symptom that means the env vars aren't set.

## Database setup

Run the SQL files in the Supabase SQL Editor **in order** — see
**[SETUP.md](SETUP.md) §4** for the full list, the Firebase/push setup, and the
security review.

## Notes

- Product & section photos are served from **Supabase Storage**, so the bundled
  `assets/products/` and `assets/categories/` folders are **not** committed.
- Login/registration is currently set aside — checkout is open and the customer
  just enters a validated Iraqi phone number (`07XXXXXXXXX`).

See **[SETUP.md](SETUP.md)** for full documentation.

# ماركت الكفيل — Kafeel Market PWA

An Arabic (RTL) Progressive Web App for a market/grocery store, with online
ordering, live order tracking, push notifications, and a secure admin dashboard.
Built on the same architecture as the Saji project (Supabase + Firebase), rebranded
to Kafeel green (`#3CA043`) with a **2-products-per-row** menu grid.

---

## 1. Project structure

| File | Purpose |
|------|---------|
| `index.html` / `app.js` / `style.css` | Customer app (menu, cart, checkout, live tracking, PWA install) |
| `admin.html` / `admin.js` / `admin.css` | Admin dashboard (orders board, menu, offers, stats) |
| `data.js` | Shared data layer — **paste your Supabase + Firebase config here** |
| `sw.js` | Service worker (offline cache + background push) — **paste Firebase config here too** |
| `manifest.json` / `manifest-admin.json` | PWA manifests |
| `supabase-schema.sql` | Database tables, RLS policies, seed data |
| `offers-migration.sql` | `offers` table (run after the schema) |
| `security-fixes.sql` | Secure `create_order` / `get_order_status` RPCs + order access tokens |
| `supabase/functions/send-notification/index.ts` | Edge Function that sends FCM push notifications |
| `assets/` | Logo + product images |

---

## 2. Add the logo (you said you'd supply it)

The code references these files in `assets/`:

```
assets/kageel_bg_removed.png  ← display logo (white calligraphy, transparent bg).
                                 Used in both headers, the login card, the auth
                                 modal, and the install screens. On light surfaces
                                 it sits on a green badge; on dark ones it shows as-is.
assets/kafeel_icon.png        ← square app icon (512×512): PWA icon, notifications, loader.
assets/kafeel_logo.png        ← original green-on-white logo (currently unused; kept as a spare).
```

The display logo is intentionally the **background-removed (white)** version so it
adapts to any surface. If you want a dark/green logo on white instead (no badge),
drop it in and tell me which `<img>` to point at it.

---

## 3. Product catalog (imported)

The real catalog has been **imported from the source APK** ("هايبر ماركت العطاء"):
- **46 sections** with their photos — compressed to ~30 KB each in
  `assets/categories/` (≈1.3 MB total). Wired into `data.js`
  (`CATEGORIES` / `CATEGORY_IMAGES`). The "العروض/الخصومات" section was excluded
  (you use the built-in offers system instead).
- **919 products** (name, price, section) → `catalog-import.sql`. Run that file to
  load them into Supabase; it replaces the placeholder seed.
- `data.js` `FALLBACK_MENU` holds a small offline sample (~3/section); the full
  catalog is served live from Supabase.

**Product photos:** ~480 products have photos (full quality) in `assets/products/`.
New/edited photos uploaded from the admin go to **Supabase Storage** automatically.
To move the bundled photos to Storage too (so nothing is served from the repo),
run once with your **service_role** key:
```
# PowerShell
$env:SUPABASE_SERVICE_KEY="<service_role key>"; python migrate-images-to-storage.py
```
It uploads `assets/products/*` to the `product-images` bucket and repoints
`menu_items.image` at the CDN URLs. After it succeeds you can delete
`assets/products/`. The `app.apk` source file in the project root can also be deleted.

**Managing the catalog (admin → إدارة القائمة):** products are grouped by section
(click a section to expand). Per product you can: **عرض** (inline discount price),
**⭐** (special), **edit** (name/price/category + replace photo), **🗑 remove**, and
the stock toggle. Add new products with **إضافة منتج**.

**Managing sections (admin → الأقسام):** create a section (name + photo), edit its
name/photo, or delete it. Renaming a section moves all its products to the new name;
deleting a section deletes its products too (confirmed). The customer app loads the
section list live from the `categories` table. After launch you (the admin) can manage everything live —
no code needed:
- **Add product**: admin dashboard → **إدارة القائمة** → **إضافة منتج** — enter
  name, category, price, and **upload a photo** (stored in Supabase Storage; needs
  `storage-setup.sql` run once). The new product appears instantly.
- Edit price/name/category, toggle stock, and ⭐ mark as special from the same tab.

Uploaded photos live in the `product-images` bucket. (Pre-bundled placeholder
images can also go in `assets/products/` if you prefer referencing by path.)

---

## 4. Supabase setup (the backend)

1. Create a **new** project at <https://supabase.com> (separate from Saji).
2. Open **SQL Editor** and run these files **in order**:
   1. `supabase-schema.sql`
   2. `offers-migration.sql`
   3. `customer-auth.sql`   ← customer accounts (must run before security-fixes)
   4. `security-fixes.sql`
   5. `storage-setup.sql`   ← product-image uploads (admin "Add product")
   6. `catalog-import.sql`  ← **the real catalog** — replaces the placeholder seed.
   7. `offers-product.sql`  ← adds the per-product discount column, then
      **re-run `security-fixes.sql`** so orders charge the discounted price.
   8. `sections.sql`        ← sections (categories) table + seed, so the admin
      can create/edit/delete sections (الأقسام tab).
   - (Only if upgrading an **existing** DB that predates the homepage rows, also
     run `homepage-features.sql`, then re-run `security-fixes.sql`. Fresh installs
     already include these columns.)
3. Create the admin login: **Authentication → Users → Add user**
   (e.g. `admin@kafeel.market` + a strong password). This is the only account
   that can log into the dashboard.
4. **Settings → API** → copy the **Project URL** and **anon public key** into
   **`env.js`** (`SUPABASE_URL`, `SUPABASE_ANON_KEY`). Create it first by copying
   the template: `cp env.example.js env.js`.

> **Why `env.js`?** `env.js` is **gitignored**, so the project URL + anon key
> stay out of this public repo. The anon key is browser-safe by design (security
> comes from RLS + the server-side RPCs in §7), but `orders` rows carry customer
> phone/address, so we keep the real key local rather than publishing it.
> `data.js` reads `window.KAFEEL_ENV` from `env.js` and falls back to placeholders.

Until you create `env.js` with real credentials, the app runs on local fallback
data and the admin login will report "not configured" — that's expected.

---

## 5. Firebase setup (push notifications) — optional but recommended

1. Create a **new** Firebase project, add a **Web app**.
2. Copy the web config into **both** `data.js` (`FIREBASE_CONFIG`) and `sw.js`
   (`firebase.initializeApp({...})`) — they must be identical.
3. **Cloud Messaging → Web Push certificates** → copy the key pair into
   `data.js` `FCM_VAPID_KEY`.
4. Deploy the Edge Function:
   ```bash
   supabase functions deploy send-notification
   ```
5. Set the function's secrets (Project → Edge Functions → Secrets, or CLI):
   - `FIREBASE_SERVICE_ACCOUNT` = the full service-account JSON (Project settings →
     Service accounts → Generate new private key)
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
6. Edit `ALLOWED_ORIGINS` in
   `supabase/functions/send-notification/index.ts` to your real domain(s).

If you skip Firebase, the app still works — it just won't send push notifications.

---

## 6. Run it locally

A service worker + PWA features need to be served over HTTP (not `file://`).
From the project folder:

```bash
# Python
python -m http.server 8080
# or Node
npx serve -l 8080
```

Then open <http://localhost:8080/index.html> (customer) and
<http://localhost:8080/admin.html> (dashboard).

---

## 7. Security review (you asked: "check the current way, if it's secure, use it")

I reviewed the model — it is sound, and I kept it. Summary:

- **Admin auth:** Supabase Auth email/password. No password or admin secret lives
  in the code. The dashboard only opens for a logged-in session.
- **Row Level Security** is enabled on every table. All writes (menu, orders,
  offers, settings) require `auth.uid()` — i.e. the logged-in admin.
- **Orders can't be forged:** customers never write prices. `create_order` is a
  `SECURITY DEFINER` RPC that looks up real prices server-side, validates stock and
  offer expiry, enforces the minimum order, and computes delivery fee + promo
  discount itself. It returns a random `access_token`.
- **Order tracking is token-gated:** `get_order_status` only returns a status when
  the caller presents the matching `access_token` (stored in the customer's own
  browser).
- **Edge Function** uses the service-role key from environment secrets (never the
  client), verifies the order exists, and restricts CORS to your domains.
- **No real credentials are committed** — every config value is a `YOUR_...`
  placeholder.

**One residual trade-off to decide:** the schema keeps a public `SELECT` policy on
`orders` / `order_items`. This is what lets the customer's *realtime* tracking card
update instantly. The downside is that anyone with the anon key could read order
rows (which include phone/address). If you prefer maximum privacy over instant
realtime updates, lock those `SELECT` policies to admin-only — customer tracking
then falls back to the token-gated `get_order_status` lookup. Tell me which you
want and I'll set it.

---

## 8. Homepage layout & curated rows

The customer homepage is a **landing page**, not a full product list. Top → bottom:

1. **الأقسام** — category cards (slidable). Tapping one opens that category's own
   page (`#categoryScreen`) with its full product grid. **المزيد** opens a page
   listing every section.
2. **العروض** — products you've discounted. To add an offer: **إدارة القائمة** →
   edit a product → enter **سعر العرض** (must be less than the price). It appears in
   this swipeable row with the original price struck through and the new price on a
   green highlight. The discount is enforced at checkout server-side (`offer_price`).
   Manage/remove offers from the admin **العروض** tab.
3. **🔥 الأكثر مبيعاً** — auto best-sellers, ordered by `menu_items.sales_count`
   (incremented on each purchase by `create_order`). Hidden until there are sales.
4. **⭐ منتجات مميزة** — products you flag as special. Toggle them with the **⭐**
   button in the admin **إدارة القائمة** tab (`is_special` column).

Products therefore appear only inside their category page (plus any curated row),
never as one long list on the homepage.

---

## 9. Checkout & phone (login set aside for now)

**No login/registration is required to order.** Anyone browses *and* orders
freely; the customer just enters their **phone number at checkout**. The header
login/register buttons are hidden (`#headerAuth` is `display:none`) — the whole
auth stack (modal, RPCs, `customer-auth.sql`) is still in the project, dormant and
ready to re-enable later by removing that `display:none`.

**Phone field (checkout):**
- The customer types the **bare local Iraqi number — no `+964`, digits only**,
  e.g. `0770xxxxxxx`. The input strips non-digits and caps at 11 characters.
- Validation (both client *and* server): must match `^07[5789]\d{8}$` — 11 digits,
  starting `075` (Korek), `077`/`078` (Asiacell), `078`/`079` (Zain). Anything else
  is rejected.
- The number is stored as-is on the order (`orders.phone`).

**Where validation lives:**
- **Client:** `validatePhone()` / `PHONE_REGEX` in `data.js`; the checkout form
  blocks submit and shows an inline error on a bad number.
- **Server (defense-in-depth):** `create_order` (in `security-fixes.sql`) re-checks
  the phone with the same regex and raises `invalid_phone` if it fails — the client
  can't bypass it.
- The login **session token is optional**: `create_order` still accepts one and, if
  valid, stamps `orders.customer_id`; with no token the order is placed as a guest.

> Re-run `security-fixes.sql` after this change so the live `create_order` is the
> guest-checkout + server-side-phone-validation version.

**WhatsApp OTP — not wired yet (by design).** The account hooks are in place for later:
- `customer_otp` table + `phone_verified` flag.
- `customer_reset_password` already **requires a verified OTP**, so password reset
  is inert (cannot be abused) until OTP delivery is added — the UI shows a
  "coming soon via WhatsApp" note. When you add a `customer_send_otp` /
  `customer_verify_otp` step (e.g. a Supabase Edge Function calling the WhatsApp
  Business API), register can be switched to "stage until verified" and reset goes
  live, with no change to the client contract.

---

## 10. What changed vs. the Saji project

- Color theme orange → **Kafeel green `#3CA043`** (light `#E8F5E9`).
- Branding **مطعم صاجي → ماركت الكفيل** everywhere; logo + icon paths updated.
- Menu layout changed from **1 card/row → 2 cards/row** (vertical cards, image on top).
- Restaurant wording → market wording ("preparing" → "packing", "notes for the
  cook" → "notes on the product", hours/footer placeholders).
- Removed the Saji-specific static "family offer" and all restaurant dishes/assets.
- Excluded legacy files (the old `Code.gs` Google Apps Script backend).
- Fresh Supabase + Firebase config placeholders (new, separate project).
- Added a graceful offline fallback so the app loads before the backend is wired.

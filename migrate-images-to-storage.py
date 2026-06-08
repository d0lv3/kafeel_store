# ─────────────────────────────────────────────────────────────
# migrate-images-to-storage.py
# Uploads every assets/products/*.jpg to the Supabase Storage bucket
# `product-images`, then points menu_items.image at the public URLs.
#
# Needs your SERVICE ROLE key (Supabase → Settings → API → service_role).
# Keep it secret — pass it via env var so it never lands in your shell history:
#
#   PowerShell:  $env:SUPABASE_URL="https://xxxx.supabase.co"; $env:SUPABASE_SERVICE_KEY="eyJ..."; python migrate-images-to-storage.py
#   bash:        SUPABASE_URL="https://xxxx.supabase.co" SUPABASE_SERVICE_KEY="eyJ..." python migrate-images-to-storage.py
#
# Safe to re-run (uploads use upsert). After it finishes, the app loads
# product photos from Supabase's CDN and assets/products/ is no longer needed.
# ─────────────────────────────────────────────────────────────
import os, glob, json, urllib.request, urllib.parse, concurrent.futures

PROJECT_URL = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
BUCKET = "product-images"
KEY = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
PROD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "products")

if not PROJECT_URL:
    raise SystemExit("Set SUPABASE_URL env var to your project URL (https://xxxx.supabase.co) first.")
if not KEY:
    raise SystemExit("Set SUPABASE_SERVICE_KEY env var to your service_role key first.")

def upload(path):
    item_id = os.path.splitext(os.path.basename(path))[0]
    obj = "products/" + item_id + ".jpg"
    with open(path, "rb") as f:
        data = f.read()
    # 1) upload to Storage (upsert)
    req = urllib.request.Request(
        f"{PROJECT_URL}/storage/v1/object/{BUCKET}/{obj}",
        data=data, method="POST",
        headers={"Authorization": "Bearer " + KEY, "apikey": KEY,
                 "Content-Type": "image/jpeg", "x-upsert": "true"})
    urllib.request.urlopen(req, timeout=60).read()
    public_url = f"{PROJECT_URL}/storage/v1/object/public/{BUCKET}/{obj}"
    # 2) point the product row at the public URL
    body = json.dumps({"image": public_url}).encode()
    req2 = urllib.request.Request(
        f"{PROJECT_URL}/rest/v1/menu_items?id=eq.{urllib.parse.quote(item_id)}",
        data=body, method="PATCH",
        headers={"Authorization": "Bearer " + KEY, "apikey": KEY,
                 "Content-Type": "application/json", "Prefer": "return=minimal"})
    urllib.request.urlopen(req2, timeout=40).read()
    return item_id

files = glob.glob(os.path.join(PROD_DIR, "*.jpg"))
print("uploading", len(files), "images to Supabase Storage...")
ok = err = 0
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
    futs = {ex.submit(upload, p): p for p in files}
    for i, fut in enumerate(concurrent.futures.as_completed(futs), 1):
        try:
            fut.result(); ok += 1
        except Exception as e:
            err += 1; print("FAIL", os.path.basename(futs[fut]), e)
        if i % 50 == 0:
            print(f"  {i}/{len(files)} (ok={ok} err={err})")
print(f"DONE: {ok} uploaded & linked, {err} failed.")

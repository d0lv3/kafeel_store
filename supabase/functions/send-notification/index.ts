import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://kafeel-store.vercel.app",
  "http://localhost:8080",
  "http://localhost:3000",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const STATUS_NOTIFICATIONS: Record<
  string,
  { title: string; body: (id: string) => string }
> = {
  new_order: {
    title: "🔔 طلب جديد!",
    body: (id) => `طلب جديد ${id} — اضغط للمراجعة`,
  },
  cooking: {
    title: "📦 جاري تجهيز طلبك",
    body: (id) => `بدأنا بتجهيز طلبك ${id}`,
  },
  delivery: {
    title: "🚗 طلبك في الطريق",
    body: (id) => `طلبك ${id} في طريقه إليك`,
  },
  done: {
    title: "✅ تم توصيل طلبك",
    body: (id) => `تم تسليم طلبك ${id} بنجاح`,
  },
  cancelled: {
    title: "❌ تم إلغاء طلبك",
    body: (id) => `تم إلغاء طلبك ${id}`,
  },
};

function base64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function getFirebaseConfig() {
  const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT not set");
  return JSON.parse(raw);
}

async function getAccessToken(
  serviceAccount: Record<string, string>
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();

  const header = base64url(
    encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  );
  const payload = base64url(
    encoder.encode(
      JSON.stringify({
        iss: serviceAccount.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      })
    )
  );

  const signInput = `${header}.${payload}`;

  const pemContents = serviceAccount.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\n/g, "");
  const binaryKey = Uint8Array.from(atob(pemContents), (c) =>
    c.charCodeAt(0)
  );

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      encoder.encode(signInput)
    )
  );

  const jwt = `${signInput}.${base64url(signature)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error("Failed to get access token: " + JSON.stringify(data));
  }
  return data.access_token;
}

async function sendFCM(
  token: string,
  title: string,
  body: string,
  accessToken: string,
  projectId: string
) {
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
        },
      }),
    }
  );
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }

  let body: { orderId: string; status: string };
  try {
    body = await req.json();
  } catch (err) {
    return Response.json(
      { error: "Invalid request body", detail: (err as Error).message },
      { status: 400, headers: getCorsHeaders(req) }
    );
  }

  try {
    const { orderId, status } = body;

    const notif = STATUS_NOTIFICATIONS[status];
    if (!notif) {
      return Response.json(
        { success: true, skipped: true },
        { headers: getCorsHeaders(req) }
      );
    }

    const targetOrderId = status === "new_order" ? "ADMIN" : orderId;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseServiceKey);

    // Validate that the order actually exists (prevents abuse)
    if (status !== "new_order") {
      const { data: order } = await sb
        .from("orders")
        .select("id")
        .eq("id", orderId)
        .maybeSingle();
      if (!order) {
        return Response.json(
          { error: "Order not found" },
          { status: 404, headers: getCorsHeaders(req) }
        );
      }
    }

    const { data: tokens } = await sb
      .from("push_tokens")
      .select("fcm_token")
      .eq("order_id", targetOrderId);

    if (!tokens || tokens.length === 0) {
      return Response.json(
        { success: true, noTokens: true },
        { headers: getCorsHeaders(req) }
      );
    }

    let firebaseConfig: Record<string, string>;
    try {
      firebaseConfig = getFirebaseConfig();
    } catch (err) {
      return Response.json(
        { error: "Firebase config parse failed", detail: (err as Error).message },
        { status: 500, headers: getCorsHeaders(req) }
      );
    }

    const accessToken = await getAccessToken(firebaseConfig);
    const title = notif.title;
    const notifBody = notif.body(orderId);

    const results = await Promise.allSettled(
      tokens.map((t: { fcm_token: string }) =>
        sendFCM(t.fcm_token, title, notifBody, accessToken, firebaseConfig.project_id)
      )
    );

    return Response.json(
      { success: true, sent: results.length },
      { headers: getCorsHeaders(req) }
    );
  } catch (err) {
    return Response.json(
      { error: (err as Error).message },
      { status: 500, headers: getCorsHeaders(req) }
    );
  }
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ ok: false, error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceRole, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data: callerData, error: callerError } = await admin.auth.getUser(token);
    if (callerError || !callerData.user) return json({ ok: false, error: "Unauthorized" }, 401);

    const { data: membership } = await admin
      .from("admin_users")
      .select("user_id")
      .eq("user_id", callerData.user.id)
      .maybeSingle();

    if (!membership) return json({ ok: false, error: "Admin access required" }, 403);

    const body = await req.json();
    const full_name = String(body?.full_name || "").trim();
    const email = String(body?.email || "").trim().toLowerCase();
    const password = String(body?.password || "");

    if (!full_name || !email || password.length < 8) {
      return json({ ok: false, error: "Name, email and an 8+ character password are required" }, 400);
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name }
    });
    if (createError || !created.user) return json({ ok: false, error: createError?.message || "Could not create user" }, 400);

    const { error: profileError } = await admin.from("profiles").insert({
      id: created.user.id,
      full_name,
      email,
      role: "delivery_guy",
      active: true
    });

    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ ok: false, error: profileError.message }, 400);
    }

    return json({ ok: true, user_id: created.user.id });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

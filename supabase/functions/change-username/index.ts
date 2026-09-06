// Version 1.0.0
// Deploy as a Supabase Edge Function named change-username.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Not authenticated" }, 401);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Not authenticated" }, 401);
    const body = await req.json();
    const username = String(body.username || "").trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(username)) return json({ error: "Username must be 3–24 letters, numbers, or underscores." }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: existing, error: checkError } = await admin.from("profiles").select("id").eq("username", username).neq("id", user.id).maybeSingle();
    if (checkError) return json({ error: checkError.message }, 500);
    if (existing) return json({ error: "That username is already taken." }, 409);

    const syntheticEmail = `${username}@${new URL(Deno.env.get("SUPABASE_URL")!).hostname}`;
    const { error: authError } = await admin.auth.admin.updateUserById(user.id, { email: syntheticEmail, email_confirm: true, user_metadata: { ...user.user_metadata, username } });
    if (authError) return json({ error: authError.message }, 400);
    const { error: profileError } = await admin.from("profiles").update({ username, updated_at: new Date().toISOString() }).eq("id", user.id);
    if (profileError) return json({ error: profileError.message }, 500);
    return json({ username });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.0";
import { registerUserAndSendConfirmation } from "../_shared/auth-resend-flow.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ success: false, error: "method_not_allowed" }, 405);
  }

  try {
    let body: {
      email?: string;
      password?: string;
      redirectPath?: string;
      metadata?: Record<string, unknown>;
    } = {};

    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json({ success: false, error: "invalid_json" });
    }

    const email = body.email?.trim().toLowerCase();
    const password = body.password ?? "";

    if (!email || !email.includes("@")) {
      return json({ success: false, error: "missing_email", message: "Informe um e-mail válido." });
    }
    if (password.length < 6) {
      return json({
        success: false,
        error: "weak_password",
        message: "A senha deve ter no mínimo 6 caracteres.",
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) {
      console.error("[auth-signup-resend] misconfigured");
      return json({ success: false, error: "server_misconfigured" });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const result = await registerUserAndSendConfirmation(admin, {
      email,
      password,
      redirectPath: body.redirectPath,
      metadata: body.metadata,
    });

    if (!result.ok) {
      return json({ success: false, error: result.error, message: result.message });
    }

    return json({ success: true, needsConfirmation: true });
  } catch (err) {
    console.error("[auth-signup-resend] catch:", err);
    return json({ success: false, error: "unexpected" });
  }
});

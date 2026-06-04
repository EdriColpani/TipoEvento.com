import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.0";
import { sendAuthLinkViaResend } from "../_shared/auth-resend-flow.ts";

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
    let body: { email?: string; redirectPath?: string } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json({ success: false, error: "invalid_json" });
    }

    const email = body.email?.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return json({ success: false, error: "missing_email", message: "Informe um e-mail válido." });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) {
      console.error("[auth-recovery-resend] misconfigured");
      return json({ success: false, error: "server_misconfigured" });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const result = await sendAuthLinkViaResend(admin, {
      email,
      linkType: "recovery",
      redirectPath: body.redirectPath ?? "/reset-password",
    });

    if (!result.ok) {
      // Não revelar se o e-mail existe — resposta genérica de sucesso para recovery
      if (result.error === "generate_link_failed" && result.message.includes("Não encontramos")) {
        return json({ success: true });
      }
      console.warn("[auth-recovery-resend] send failed:", result.message);
      return json({ success: true });
    }

    return json({ success: true });
  } catch (err) {
    console.error("[auth-recovery-resend] catch:", err);
    return json({ success: true });
  }
});

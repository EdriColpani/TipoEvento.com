import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.0";
import {
  buildAuthEmail,
  sanitizeAuthRedirectTo,
  sendViaResend,
} from "../_shared/eventfest-mail.ts";

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

function getAuthRedirect(redirectPath?: string): string {
  const productionOrigin = (
    Deno.env.get("SITE_URL") ??
    Deno.env.get("VITE_SITE_URL") ??
    "https://www.eventfest.com.br"
  )
    .trim()
    .replace(/\/$/, "");
  const path =
    typeof redirectPath === "string" && redirectPath.startsWith("/")
      ? redirectPath
      : "/login";
  return sanitizeAuthRedirectTo(`${productionOrigin}${path}`, Deno.env.get("SITE_URL"));
}

/** Corrige redirect_to dentro do action_link gerado pelo Auth (ex.: localhost). */
function fixActionLinkRedirect(actionLink: string, redirectTo: string): string {
  try {
    const url = new URL(actionLink);
    url.searchParams.set("redirect_to", redirectTo);
    return url.toString();
  } catch {
    return actionLink;
  }
}

function translateGenerateLinkError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("already") && lower.includes("confirmed")) {
    return "Este e-mail já foi confirmado. Faça login para continuar.";
  }
  if (lower.includes("not found") || lower.includes("user not found")) {
    return "Não encontramos cadastro pendente com este e-mail.";
  }
  if (lower.includes("rate") || lower.includes("too many")) {
    return "Aguarde alguns minutos antes de solicitar outro e-mail.";
  }
  return "Não foi possível gerar o link de confirmação. Tente novamente.";
}

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
      body = (await req.json()) as { email?: string };
    } catch {
      return json({ success: false, error: "invalid_json" });
    }

    const email = body.email?.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return json({ success: false, error: "missing_email" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) {
      console.error("[resend-signup-confirmation] misconfigured");
      return json({ success: false, error: "server_misconfigured" });
    }

    const redirectTo = getAuthRedirect(body.redirectPath);
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "signup",
      email,
      options: { redirectTo },
    });

    if (linkError) {
      console.error("[resend-signup-confirmation] generateLink:", linkError.message);
      return json({
        success: false,
        error: "generate_link_failed",
        message: translateGenerateLinkError(linkError.message),
      });
    }

    const rawActionLink = linkData?.properties?.action_link;
    if (!rawActionLink) {
      return json({
        success: false,
        error: "no_action_link",
        message: "Não foi possível gerar o link de confirmação.",
      });
    }

    const confirmationUrl = fixActionLinkRedirect(rawActionLink, redirectTo);
    const userName =
      (linkData.user?.user_metadata as { name?: string } | undefined)?.name?.trim() ||
      undefined;

    const content = buildAuthEmail({
      actionType: "signup",
      confirmationUrl,
      userName,
    });

    if (!content) {
      return json({ success: false, error: "template_missing" });
    }

    const sendResult = await sendViaResend({
      to: email,
      subject: content.subject,
      html: content.html,
    });

    if (!sendResult.ok) {
      console.error(
        "[resend-signup-confirmation] Resend:",
        sendResult.status,
        sendResult.detail,
      );
      return json({
        success: false,
        error: "resend_rejected",
        message: "Falha ao enviar e-mail. Verifique a configuração da Resend.",
        detail: sendResult.detail,
      });
    }

    console.info("[resend-signup-confirmation] ok →", email);
    return json({ success: true });
  } catch (err) {
    console.error("[resend-signup-confirmation] catch:", err);
    return json({ success: false, error: "unexpected" });
  }
});

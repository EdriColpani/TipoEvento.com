import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.0";
import { invitePartnerOwnerViaResend } from "../_shared/auth-resend-flow.ts";

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

const ADMIN_MASTER_USER_TYPE_ID = 1;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ success: false, error: "method_not_allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({
        success: false,
        error: "unauthorized",
        message: "Faça login como administrador master para enviar o convite.",
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) {
      console.error("[invite-partner-company-owner] misconfigured");
      return json({ success: false, error: "server_misconfigured" });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const jwt = authHeader.slice(7).trim();
    const { data: userData, error: userError } = await admin.auth.getUser(jwt);
    const user = userData?.user;
    if (userError || !user) {
      return json({
        success: false,
        error: "unauthorized",
        message: "Sessão inválida. Atualize a página e tente novamente.",
      });
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("tipo_usuario_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || profile?.tipo_usuario_id !== ADMIN_MASTER_USER_TYPE_ID) {
      return json({
        success: false,
        error: "forbidden",
        message: "Apenas o administrador master pode enviar convites de empresa parceira.",
      });
    }

    let body: {
      companyId?: string;
      ownerEmail?: string;
      companyName?: string;
    } = {};

    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json({ success: false, error: "invalid_json" });
    }

    const companyId = body.companyId?.trim();
    const ownerEmail = body.ownerEmail?.trim().toLowerCase();
    const companyName = body.companyName?.trim();

    if (!companyId) {
      return json({
        success: false,
        error: "missing_company",
        message: "Empresa não informada.",
      });
    }
    if (!ownerEmail || !ownerEmail.includes("@")) {
      return json({
        success: false,
        error: "missing_email",
        message: "Informe o e-mail do gestor (dono).",
      });
    }

    const { data: company, error: companyError } = await admin
      .from("companies")
      .select("id, company_kind, trade_name, corporate_name")
      .eq("id", companyId)
      .maybeSingle();

    if (companyError || !company) {
      return json({
        success: false,
        error: "company_not_found",
        message: "Empresa não encontrada.",
      });
    }

    if (company.company_kind !== "partner") {
      return json({
        success: false,
        error: "not_partner",
        message: "Esta empresa não é do tipo parceira.",
      });
    }

    const displayName =
      companyName ||
      (company.trade_name as string | null)?.trim() ||
      (company.corporate_name as string | null)?.trim() ||
      "Empresa parceira";

    const { data: inviteRow } = await admin
      .from("company_member_invites")
      .select("id")
      .eq("company_id", companyId)
      .eq("email", ownerEmail)
      .eq("role", "owner")
      .maybeSingle();

    if (!inviteRow) {
      const { error: inviteInsertError } = await admin.from("company_member_invites").insert({
        company_id: companyId,
        email: ownerEmail,
        role: "owner",
      });
      if (inviteInsertError && !inviteInsertError.message?.includes("duplicate")) {
        console.error("[invite-partner-company-owner] invite insert:", inviteInsertError.message);
        return json({
          success: false,
          error: "invite_insert_failed",
          message: "Não foi possível registrar o convite do gestor.",
        });
      }
    }

    const inviteResult = await invitePartnerOwnerViaResend(admin, {
      email: ownerEmail,
      companyName: displayName,
    });

    if (!inviteResult.ok) {
      return json({
        success: false,
        error: inviteResult.error ?? "email_failed",
        message: inviteResult.message,
      });
    }

    return json({
      success: true,
      mode: inviteResult.mode,
      message:
        inviteResult.mode === "invite"
          ? "E-mail enviado. O gestor deve criar a senha pelo link recebido."
          : "E-mail enviado. O gestor deve entrar pelo link recebido.",
    });
  } catch (err) {
    console.error("[invite-partner-company-owner] catch:", err);
    return json({ success: false, error: "unexpected" });
  }
});

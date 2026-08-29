import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.0";
import { invitePdvOperatorViaResend } from "../_shared/auth-resend-flow.ts";

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

async function findAuthUserIdByEmail(
  admin: ReturnType<typeof createClient>,
  email: string,
): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  for (let page = 1; page <= 8; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    const found = data.users.find((u) => (u.email ?? "").toLowerCase() === normalized);
    if (found) return found.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

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
        message: "Faça login para convidar operadores.",
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) {
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

    let body: {
      companyId?: string;
      operatorEmail?: string;
      companyName?: string;
    } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json({ success: false, error: "invalid_json" });
    }

    const companyId = body.companyId?.trim();
    const operatorEmail = body.operatorEmail?.trim().toLowerCase();
    const companyNameHint = body.companyName?.trim();

    if (!companyId) {
      return json({
        success: false,
        error: "missing_company",
        message: "Empresa não informada.",
      });
    }
    if (!operatorEmail || !operatorEmail.includes("@")) {
      return json({
        success: false,
        error: "missing_email",
        message: "Informe o e-mail do operador.",
      });
    }

    const { data: owns } = await admin.rpc("user_owns_company", {
      p_company_id: companyId,
      p_user_id: user.id,
    });

    const { data: profile } = await admin
      .from("profiles")
      .select("tipo_usuario_id")
      .eq("id", user.id)
      .maybeSingle();

    const isAdminMaster = profile?.tipo_usuario_id === 1;
    if (!owns && !isAdminMaster) {
      return json({
        success: false,
        error: "forbidden",
        message: "Apenas o proprietário da empresa pode convidar operadores PDV.",
      });
    }

    const { data: company, error: companyError } = await admin
      .from("companies")
      .select("id, trade_name, corporate_name")
      .eq("id", companyId)
      .maybeSingle();

    if (companyError || !company) {
      return json({
        success: false,
        error: "company_not_found",
        message: "Empresa não encontrada.",
      });
    }

    const displayName =
      companyNameHint ||
      (company.trade_name as string | null)?.trim() ||
      (company.corporate_name as string | null)?.trim() ||
      "Empresa";

    const targetUserId = await findAuthUserIdByEmail(admin, operatorEmail);
    let linkedImmediately = false;

    if (targetUserId) {
      await admin.from("profiles").update({ tipo_usuario_id: 2 }).eq("id", targetUserId);

      const { data: link } = await admin
        .from("user_companies")
        .select("user_id, role")
        .eq("user_id", targetUserId)
        .eq("company_id", companyId)
        .maybeSingle();

      if (!link) {
        const { error: linkError } = await admin.from("user_companies").insert({
          user_id: targetUserId,
          company_id: companyId,
          role: "pdv_operator",
          is_primary: false,
        });
        if (linkError) {
          console.error("[invite-pdv-operator] link:", linkError.message);
          return json({
            success: false,
            error: "link_failed",
            message: "Não foi possível vincular o operador à empresa.",
          });
        }
      } else if (link.role === "owner") {
        return json({
          success: false,
          error: "is_owner",
          message: "Este e-mail já é o proprietário da empresa.",
        });
      }

      linkedImmediately = true;
      await admin
        .from("company_member_invites")
        .delete()
        .eq("company_id", companyId)
        .eq("email", operatorEmail);
    } else {
      const { error: inviteError } = await admin.from("company_member_invites").upsert(
        {
          company_id: companyId,
          email: operatorEmail,
          role: "pdv_operator",
          invited_by: user.id,
          accepted_at: null,
        },
        { onConflict: "company_id,email" },
      );
      if (inviteError) {
        console.error("[invite-pdv-operator] invite:", inviteError.message);
        return json({
          success: false,
          error: "invite_insert_failed",
          message: "Não foi possível registrar o convite.",
        });
      }
    }

    const emailResult = await invitePdvOperatorViaResend(admin, {
      email: operatorEmail,
      companyName: displayName,
    });

    if (!emailResult.ok) {
      return json({
        success: false,
        error: emailResult.error ?? "email_failed",
        message: emailResult.message,
        linked_immediately: linkedImmediately,
      });
    }

    return json({
      success: true,
      mode: emailResult.mode,
      linked_immediately: linkedImmediately,
      message:
        emailResult.mode === "invite"
          ? "Convite enviado por e-mail. O operador deve criar a senha pelo link."
          : "E-mail enviado. O operador deve entrar pelo link para acessar o PDV.",
    });
  } catch (err) {
    console.error("[invite-pdv-operator] catch:", err);
    return json({
      success: false,
      error: "unexpected",
      message: "Erro inesperado ao convidar.",
    });
  }
});

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  RESEND_COOLDOWN_SECONDS,
  MAX_SENDS_PER_HOUR,
  OTP_TTL_MINUTES,
  clientIp,
  corsHeaders,
  createServiceClient,
  hashOtp,
  json,
  logAudit,
  maskEmail,
  randomOtpCode,
  randomSalt,
  requireUser,
  sendContractOtpEmail,
} from "../_shared/contract-acceptance-secure.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const { admin } = createServiceClient();
    const auth = await requireUser(admin, req);
    if ("error" in auth && auth.error) return auth.error;
    const user = auth.user!;
    const email = (user.email ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return json({
        ok: false,
        error: "email_missing",
        message: "Sua conta não possui e-mail cadastrado para envio do código.",
      }, 400);
    }

    let body: {
      contractId?: string;
      contractType?: string;
      companyId?: string | null;
      acceptanceSource?: string;
    } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }

    const contractId = body.contractId?.trim();
    const contractType = body.contractType?.trim();
    const companyId = body.companyId?.trim() || null;
    const acceptanceSource = (body.acceptanceSource ?? "web").trim() || "web";
    if (!contractId || !contractType) {
      return json({
        ok: false,
        error: "invalid_contract",
        message: "Contrato inválido para envio do código.",
      }, 400);
    }

    if (companyId) {
      const { data: link } = await admin
        .from("user_companies")
        .select("company_id")
        .eq("company_id", companyId)
        .eq("user_id", user.id)
        .maybeSingle();
      const { data: profile } = await admin
        .from("profiles")
        .select("tipo_usuario_id")
        .eq("id", user.id)
        .maybeSingle();
      const isAdmin = Number(profile?.tipo_usuario_id) === 1;
      if (!link && !isAdmin) {
        return json({
          ok: false,
          error: "forbidden",
          message: "Sem permissão para aceitar contrato desta empresa.",
        }, 403);
      }
    }

    const { data: contract, error: contractError } = await admin
      .from("event_contracts")
      .select("id, title, version, contract_type, content, is_active")
      .eq("id", contractId)
      .maybeSingle();

    if (contractError || !contract) {
      return json({ ok: false, error: "contract_not_found", message: "Contrato não encontrado." }, 404);
    }
    if (contract.contract_type !== contractType) {
      return json({
        ok: false,
        error: "contract_type_mismatch",
        message: "Tipo de contrato não corresponde.",
      }, 400);
    }

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: hourCount } = await admin
      .from("contract_acceptance_otp_challenges")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", hourAgo);

    if ((hourCount ?? 0) >= MAX_SENDS_PER_HOUR) {
      return json({
        ok: false,
        error: "rate_limited",
        message: "Muitas solicitações de código. Aguarde e tente novamente.",
      }, 429);
    }

    const { data: latest } = await admin
      .from("contract_acceptance_otp_challenges")
      .select("id, created_at")
      .eq("user_id", user.id)
      .eq("contract_id", contractId)
      .is("invalidated_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latest?.created_at) {
      const elapsed = Date.now() - new Date(latest.created_at).getTime();
      if (elapsed < RESEND_COOLDOWN_SECONDS * 1000) {
        const wait = Math.ceil((RESEND_COOLDOWN_SECONDS * 1000 - elapsed) / 1000);
        return json({
          ok: false,
          error: "cooldown",
          message: `Aguarde ${wait}s para reenviar o código.`,
          retry_after_seconds: wait,
        }, 429);
      }
    }

    // Invalida challenges abertos do mesmo escopo
    await admin
      .from("contract_acceptance_otp_challenges")
      .update({ invalidated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("contract_id", contractId)
      .is("consumed_at", null)
      .is("invalidated_at", null);

    const code = randomOtpCode();
    const salt = randomSalt();
    const codeHash = await hashOtp(admin, code, salt);
    const ip = clientIp(req);
    const ua = req.headers.get("user-agent")?.slice(0, 2000) ?? null;
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();
    const destinationMasked = maskEmail(email);

    const { data: challenge, error: insertError } = await admin
      .from("contract_acceptance_otp_challenges")
      .insert({
        user_id: user.id,
        company_id: companyId,
        contract_id: contractId,
        contract_type: contractType,
        acceptance_source: acceptanceSource,
        code_hash: codeHash,
        code_salt: salt,
        destination_email: email,
        destination_masked: destinationMasked,
        expires_at: expiresAt,
        accepted_ip: ip,
        user_agent: ua,
        metadata: { contract_version: contract.version },
      })
      .select("id, expires_at, destination_masked")
      .single();

    if (insertError || !challenge) {
      console.error("[contract-acceptance-request-otp] insert", insertError?.message);
      return json({
        ok: false,
        error: "challenge_create_failed",
        message: "Não foi possível criar o código de confirmação.",
      }, 500);
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", user.id)
      .maybeSingle();
    const userName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();

    const sendResult = await sendContractOtpEmail({
      to: email,
      code,
      userName,
      contractTitle: contract.title,
    });

    if (!sendResult.ok) {
      console.error("[contract-acceptance-request-otp] resend", sendResult.detail);
      await admin
        .from("contract_acceptance_otp_challenges")
        .update({ invalidated_at: new Date().toISOString() })
        .eq("id", challenge.id);
      return json({
        ok: false,
        error: "email_send_failed",
        message: "Não foi possível enviar o e-mail com o código. Tente novamente.",
      }, 502);
    }

    // Nunca logar o código
    await logAudit(admin, {
      eventType: latest ? "otp_resent" : "otp_sent",
      actorUserId: user.id,
      challengeId: challenge.id,
      companyId,
      contractId,
      payload: {
        destination_masked: destinationMasked,
        acceptance_source: acceptanceSource,
        expires_at: expiresAt,
      },
    });

    return json({
      ok: true,
      challenge_id: challenge.id,
      destination_masked: challenge.destination_masked,
      expires_at: challenge.expires_at,
      resend_cooldown_seconds: RESEND_COOLDOWN_SECONDS,
    });
  } catch (error) {
    console.error("[contract-acceptance-request-otp] unexpected", error);
    return json({
      ok: false,
      error: "unexpected",
      message: "Erro inesperado ao solicitar o código.",
    }, 500);
  }
});

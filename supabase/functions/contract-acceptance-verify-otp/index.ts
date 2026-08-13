import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  clientIp,
  corsHeaders,
  createServiceClient,
  hashOtp,
  json,
  logAudit,
  requireUser,
} from "../_shared/contract-acceptance-secure.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const { admin } = createServiceClient();
    const auth = await requireUser(admin, req);
    if ("error" in auth && auth.error) return auth.error;
    const user = auth.user!;

    let body: { challengeId?: string; code?: string } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }

    const challengeId = body.challengeId?.trim();
    const code = (body.code ?? "").replace(/\D/g, "");
    if (!challengeId || code.length !== 6) {
      return json({
        ok: false,
        error: "invalid_code",
        message: "Informe o código de 6 dígitos.",
      }, 400);
    }

    const { data: challenge, error } = await admin
      .from("contract_acceptance_otp_challenges")
      .select("*")
      .eq("id", challengeId)
      .maybeSingle();

    if (error || !challenge) {
      return json({ ok: false, error: "challenge_not_found", message: "Código inválido ou expirado." }, 404);
    }

    if (challenge.user_id !== user.id) {
      return json({ ok: false, error: "forbidden", message: "Desafio não pertence a este usuário." }, 403);
    }

    if (challenge.invalidated_at || challenge.consumed_at) {
      return json({
        ok: false,
        error: "challenge_closed",
        message: "Este código não é mais válido. Solicite um novo.",
      }, 400);
    }

    if (new Date(challenge.expires_at).getTime() < Date.now()) {
      await logAudit(admin, {
        eventType: "otp_expired",
        actorUserId: user.id,
        challengeId: challenge.id,
        companyId: challenge.company_id,
        contractId: challenge.contract_id,
      });
      return json({
        ok: false,
        error: "otp_expired",
        message: "Código expirado. Solicite um novo.",
      }, 400);
    }

    if ((challenge.attempts ?? 0) >= (challenge.max_attempts ?? 5)) {
      await admin
        .from("contract_acceptance_otp_challenges")
        .update({ invalidated_at: new Date().toISOString() })
        .eq("id", challenge.id);
      return json({
        ok: false,
        error: "too_many_attempts",
        message: "Muitas tentativas. Solicite um novo código.",
      }, 429);
    }

    const expected = await hashOtp(admin, code, challenge.code_salt);
    if (expected !== challenge.code_hash) {
      const attempts = (challenge.attempts ?? 0) + 1;
      await admin
        .from("contract_acceptance_otp_challenges")
        .update({ attempts })
        .eq("id", challenge.id);
      await logAudit(admin, {
        eventType: "otp_failed",
        actorUserId: user.id,
        challengeId: challenge.id,
        companyId: challenge.company_id,
        contractId: challenge.contract_id,
        payload: { attempts, ip: clientIp(req) },
      });
      return json({
        ok: false,
        error: "otp_invalid",
        message: "Código incorreto.",
        attempts_remaining: Math.max(0, (challenge.max_attempts ?? 5) - attempts),
      }, 400);
    }

    const verifiedAt = new Date().toISOString();
    await admin
      .from("contract_acceptance_otp_challenges")
      .update({ verified_at: verifiedAt })
      .eq("id", challenge.id);

    await logAudit(admin, {
      eventType: "otp_verified",
      actorUserId: user.id,
      challengeId: challenge.id,
      companyId: challenge.company_id,
      contractId: challenge.contract_id,
      payload: { verified_at: verifiedAt },
    });

    return json({
      ok: true,
      challenge_id: challenge.id,
      verified_at: verifiedAt,
      destination_masked: challenge.destination_masked,
      contract_id: challenge.contract_id,
      contract_type: challenge.contract_type,
      company_id: challenge.company_id,
      acceptance_source: challenge.acceptance_source,
    });
  } catch (error) {
    console.error("[contract-acceptance-verify-otp] unexpected", error);
    return json({
      ok: false,
      error: "unexpected",
      message: "Erro inesperado ao validar o código.",
    }, 500);
  }
});

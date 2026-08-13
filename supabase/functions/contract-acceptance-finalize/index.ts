import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  PDF_BUCKET,
  buildAcceptancePdfBytes,
  buildCanonicalDocument,
  clientIp,
  corsHeaders,
  createServiceClient,
  json,
  loadPartyAndCommercial,
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
    const email = (user.email ?? "").trim().toLowerCase();

    let body: {
      challengeId?: string;
      contractId?: string;
      contractType?: string;
      companyId?: string | null;
      acceptanceSource?: string;
      scrolledToEnd?: boolean;
      idempotencyKey?: string;
      billingPlan?: string | null;
    } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }

    const challengeId = body.challengeId?.trim();
    const contractId = body.contractId?.trim();
    const contractType = body.contractType?.trim();
    const companyId = body.companyId?.trim() || null;
    const acceptanceSource = (body.acceptanceSource ?? "web").trim() || "web";
    const idempotencyKey = body.idempotencyKey?.trim() || null;
    const billingPlanHint = body.billingPlan?.trim() || null;

    if (!challengeId || !contractId || !contractType) {
      return json({
        ok: false,
        error: "invalid_payload",
        message: "Dados incompletos para finalizar o aceite.",
      }, 400);
    }

    const { data: challenge, error: challengeError } = await admin
      .from("contract_acceptance_otp_challenges")
      .select("*")
      .eq("id", challengeId)
      .maybeSingle();

    if (challengeError || !challenge) {
      return json({ ok: false, error: "challenge_not_found", message: "Confirmação inválida." }, 404);
    }
    if (challenge.user_id !== user.id) {
      return json({ ok: false, error: "forbidden", message: "Confirmação não pertence a este usuário." }, 403);
    }
    if (challenge.invalidated_at) {
      return json({ ok: false, error: "challenge_closed", message: "Código inválido. Solicite um novo." }, 400);
    }
    if (!challenge.verified_at) {
      return json({
        ok: false,
        error: "not_verified",
        message: "Confirme o código de segurança antes de assinar.",
      }, 400);
    }
    if (challenge.contract_id !== contractId || challenge.contract_type !== contractType) {
      return json({
        ok: false,
        error: "challenge_mismatch",
        message: "O código não corresponde a este contrato.",
      }, 400);
    }
    if ((challenge.company_id ?? null) !== companyId) {
      return json({
        ok: false,
        error: "company_mismatch",
        message: "Empresa do aceite não confere com a confirmação.",
      }, 400);
    }

    // Idempotência antes de consumir challenge
    if (idempotencyKey) {
      const { data: existing } = await admin
        .from("contract_acceptances")
        .select("id, contract_id, contract_version, document_hash, accepted_at, pdf_storage_path, commercial_terms_snapshot")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existing) {
        return json({
          ok: true,
          idempotent: true,
          acceptance_id: existing.id,
          contract_id: existing.contract_id,
          contract_version: existing.contract_version,
          document_hash: existing.document_hash,
          accepted_at: existing.accepted_at,
          pdf_storage_path: existing.pdf_storage_path,
          billing_plan: (existing.commercial_terms_snapshot as Record<string, unknown> | null)?.billing_plan ?? null,
        });
      }
    }

    if (challenge.consumed_at) {
      return json({
        ok: false,
        error: "already_consumed",
        message: "Este código já foi usado. Solicite um novo se precisar.",
      }, 400);
    }

    const { data: contract, error: contractError } = await admin
      .from("event_contracts")
      .select("id, title, version, contract_type, content")
      .eq("id", contractId)
      .maybeSingle();

    if (contractError || !contract) {
      return json({ ok: false, error: "contract_not_found", message: "Contrato não encontrado." }, 404);
    }

    const { party, commercial } = await loadPartyAndCommercial(admin, {
      userId: user.id,
      email,
      companyId,
      billingPlanHint,
    });

    const presented = buildCanonicalDocument({
      contractTitle: contract.title ?? "Contrato EventFest",
      contractVersion: contract.version ?? "",
      contractType: contract.contract_type,
      contractContent: contract.content ?? "",
      party,
      commercial,
    });

    const { data: documentHash, error: hashError } = await admin.rpc("compute_contract_content_hash", {
      p_content: presented,
    });
    if (hashError || typeof documentHash !== "string") {
      return json({
        ok: false,
        error: "hash_failed",
        message: "Não foi possível calcular o hash do documento.",
      }, 500);
    }

    const ip = clientIp(req);
    const ua = req.headers.get("user-agent")?.slice(0, 2000) ?? null;
    const verifiedAt = challenge.verified_at;

    const { data: registered, error: registerError } = await admin.rpc("register_contract_acceptance", {
      p_contract_id: contractId,
      p_contract_type: contractType,
      p_company_id: companyId,
      p_user_id: user.id,
      p_acceptance_source: acceptanceSource,
      p_user_agent: ua,
      p_accepted_ip: ip,
      p_scrolled_to_end: body.scrolledToEnd ?? true,
      p_metadata: {
        secure_acceptance: true,
        otp_challenge_id: challengeId,
      },
      p_party_snapshot: party,
      p_commercial_terms_snapshot: commercial,
      p_presented_document_text: presented,
      p_document_hash: documentHash,
      p_verification_method: "email_otp",
      p_verification_channel: challenge.destination_masked,
      p_verified_at: verifiedAt,
      p_pdf_storage_path: null,
      p_pdf_generated_at: null,
      p_idempotency_key: idempotencyKey,
      p_otp_challenge_id: challengeId,
    });

    if (registerError) {
      console.error("[contract-acceptance-finalize] register", registerError.message);
      return json({
        ok: false,
        error: "register_failed",
        message: registerError.message || "Falha ao registrar o aceite.",
      }, 400);
    }

    const acceptanceId = registered?.acceptance_id as string | undefined;
    const acceptedAt = (registered?.accepted_at as string | undefined) ?? new Date().toISOString();
    if (!acceptanceId) {
      return json({ ok: false, error: "register_failed", message: "Aceite sem identificador." }, 500);
    }

    if (registered?.idempotent === true) {
      return json({
        ok: true,
        idempotent: true,
        acceptance_id: acceptanceId,
        contract_id: registered.contract_id,
        contract_version: registered.contract_version,
        document_hash: registered.document_hash,
        accepted_at: acceptedAt,
        pdf_storage_path: registered.pdf_storage_path,
        billing_plan: commercial.billing_plan ?? null,
      });
    }

    await admin
      .from("contract_acceptance_otp_challenges")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", challengeId);

    const folder = companyId ?? user.id;
    const pdfPath = `${folder}/${acceptanceId}.pdf`;

    let pdfStoragePath: string | null = null;
    try {
      const pdfBytes = await buildAcceptancePdfBytes({
        canonicalText: presented,
        evidence: {
          acceptanceId,
          documentHash,
          acceptedAt,
          verificationMethod: "email_otp",
          verificationChannel: challenge.destination_masked,
          contractVersion: contract.version ?? "",
          plan: (commercial.billing_plan as string | null) ?? null,
        },
      });

      const { error: uploadError } = await admin.storage
        .from(PDF_BUCKET)
        .upload(pdfPath, pdfBytes, {
          contentType: "application/pdf",
          upsert: false,
        });

      if (uploadError) {
        console.error("[contract-acceptance-finalize] upload", uploadError.message);
        await logAudit(admin, {
          eventType: "pdf_failed",
          actorUserId: user.id,
          acceptanceId,
          challengeId,
          companyId,
          contractId,
          payload: { reason: uploadError.message },
        });
      } else {
        pdfStoragePath = pdfPath;
        const pdfGeneratedAt = new Date().toISOString();
        await admin
          .from("contract_acceptances")
          .update({
            pdf_storage_path: pdfPath,
            pdf_generated_at: pdfGeneratedAt,
          })
          .eq("id", acceptanceId);

        await logAudit(admin, {
          eventType: "pdf_generated",
          actorUserId: user.id,
          acceptanceId,
          challengeId,
          companyId,
          contractId,
          payload: { path: pdfPath },
        });
        await logAudit(admin, {
          eventType: "pdf_stored",
          actorUserId: user.id,
          acceptanceId,
          challengeId,
          companyId,
          contractId,
          payload: { path: pdfPath, bucket: PDF_BUCKET },
        });
      }
    } catch (pdfError) {
      console.error("[contract-acceptance-finalize] pdf", pdfError);
      await logAudit(admin, {
        eventType: "pdf_failed",
        actorUserId: user.id,
        acceptanceId,
        challengeId,
        companyId,
        contractId,
        payload: { reason: pdfError instanceof Error ? pdfError.message : "pdf_error" },
      });
    }

    return json({
      ok: true,
      idempotent: false,
      acceptance_id: acceptanceId,
      contract_id: contract.id,
      contract_version: contract.version,
      document_hash: documentHash,
      accepted_at: acceptedAt,
      pdf_storage_path: pdfStoragePath,
      verification_method: "email_otp",
      verification_channel: challenge.destination_masked,
      billing_plan: commercial.billing_plan ?? null,
      party_snapshot: party,
      commercial_terms_snapshot: commercial,
    });
  } catch (error) {
    console.error("[contract-acceptance-finalize] unexpected", error);
    return json({
      ok: false,
      error: "unexpected",
      message: "Erro inesperado ao finalizar o aceite.",
    }, 500);
  }
});

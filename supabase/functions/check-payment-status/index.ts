import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { resolveTicketPaymentQueryTokens } from "./mp-ticket-payment.ts";
import { extractMpPaymentFinancials } from "./mp-payment-financials.ts";
import {
  countAssignedTickets,
  emitReceivableTicketsForPaidPurchase,
} from "./emit-receivable-tickets.ts";
import { extractMpPaymentMethodFields } from "../_shared/mp-payment-method.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const supabaseService = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

async function logPaymentEvent(params: {
  transactionId: string;
  source: "manual_check" | "system";
  paymentStatus?: string | null;
  receivableStatus?: string | null;
  paymentStatusDetail?: string | null;
  mpPaymentId?: string | null;
  mpPreferenceId?: string | null;
  payload?: Record<string, unknown>;
}) {
  const { error } = await supabaseService.from("payment_events").insert({
    transaction_id: params.transactionId,
    source: params.source,
    payment_status: params.paymentStatus ?? null,
    receivable_status: params.receivableStatus ?? null,
    payment_status_detail: params.paymentStatusDetail ?? null,
    mp_payment_id: params.mpPaymentId ?? null,
    mp_preference_id: params.mpPreferenceId ?? null,
    payload: params.payload ?? null,
  });

  if (error) {
    console.error("[check-payment-status] Failed to write payment_events log:", error);
  }
}

function isTerminalOrApprovedStatus(status: string | null): boolean {
  return status === "approved" || status === "authorized" || status === "rejected" || status === "cancelled";
}

function isMpApproved(status: string | null): boolean {
  return status === "approved" || status === "authorized";
}

/**
 * O split financeiro só é gravado pelo webhook. Quando o MP não reenvia a notificação
 * de aprovado, o recebível fica pago sem financial_splits — aqui garantimos o registro.
 */
async function ensureFinancialSplit(transactionId: string): Promise<boolean> {
  const { count, error } = await supabaseService
    .from("financial_splits")
    .select("id", { count: "exact", head: true })
    .eq("transaction_id", transactionId);

  if (error) {
    console.error("[check-payment-status] Failed to check financial_splits:", error);
    return false;
  }

  if ((count ?? 0) > 0) return true;

  const { error: backfillError } = await supabaseService.rpc(
    "admin_backfill_missing_financial_splits",
    { p_receivable_id: transactionId },
  );

  if (backfillError) {
    console.error("[check-payment-status] Failed to backfill financial_splits:", backfillError);
    return false;
  }

  return true;
}

async function triggerWebhookReprocess(mpPaymentId: string): Promise<{
  triggered: boolean;
  httpStatus: number | null;
  result: string | null;
}> {
  const webhookBase = `${Deno.env.get("SUPABASE_URL") ?? ""}/functions/v1/mercadopago-webhook`;
  const webhookUrl = `${webhookBase}?topic=payment&id=${encodeURIComponent(mpPaymentId)}`;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  try {
    const webhookResp = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(serviceKey ? { Authorization: `Bearer ${serviceKey}` } : {}),
      },
      body: JSON.stringify({
        type: "payment",
        data: { id: mpPaymentId },
      }),
    });
    const webhookText = await webhookResp.text().catch(() => "");
    return {
      triggered: true,
      httpStatus: webhookResp.status,
      result: webhookResp.ok
        ? "Webhook reprocessado com sucesso."
        : `Webhook retornou ${webhookResp.status}: ${webhookText.slice(0, 500)}`,
    };
  } catch (reprocessError: unknown) {
    const msg = reprocessError instanceof Error ? reprocessError.message : "erro desconhecido";
    return {
      triggered: true,
      httpStatus: null,
      result: `Falha ao reprocessar webhook: ${msg}`,
    };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized: Missing Authorization header" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const supabaseAnon = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userError } = await supabaseAnon.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized: Invalid token or user not found" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const body = await req.json().catch(() => ({}));
    const transactionId = typeof body.transactionId === "string" ? body.transactionId.trim() : "";
    if (!transactionId) {
      return new Response(JSON.stringify({ error: "transactionId is required." }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const { data: receivable, error: receivableError } = await supabaseService
      .from("receivables")
      .select(
        "id, status, payment_status, mp_status_detail, mp_payment_id, mp_preference_id, client_user_id, manager_user_id, collector_type, settlement_channel, event_id, gross_amount, total_value",
      )
      .eq("id", transactionId)
      .maybeSingle();

    if (receivableError) throw receivableError;
    if (!receivable) {
      return new Response(JSON.stringify({ error: "Transação não encontrada." }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    const canAccess = receivable.client_user_id === user.id || receivable.manager_user_id === user.id;
    if (!canAccess) {
      return new Response(JSON.stringify({ error: "Forbidden: transaction is not owned by user." }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    let mpAccessTokens: string[];
    try {
      mpAccessTokens = await resolveTicketPaymentQueryTokens(
        supabaseService,
        receivable.manager_user_id as string,
        {
          collectorType: (receivable as { collector_type?: string | null }).collector_type ?? null,
          settlementChannel:
            (receivable as { settlement_channel?: string | null }).settlement_channel ?? null,
        },
      );
    } catch (credErr) {
      const msg = credErr instanceof Error ? credErr.message : "Credencial MP indisponível.";
      return new Response(JSON.stringify({ error: msg }), { status: 502, headers: corsHeaders });
    }

    let paymentPayload: Record<string, unknown> | null = null;
    let mpAccessToken = mpAccessTokens[0];

    const fetchPaymentById = async (token: string, paymentId: string) => {
      const byIdResp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (!byIdResp.ok) return null;
      return (await byIdResp.json()) as Record<string, unknown>;
    };

    const searchPaymentByExternalRef = async (token: string) => {
      const searchResp = await fetch(
        `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(transactionId)}&sort=date_created&criteria=desc&limit=1`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        },
      );
      if (!searchResp.ok) return null;
      const searchJson = await searchResp.json();
      const results = Array.isArray(searchJson.results) ? searchJson.results : [];
      return results.length > 0 ? (results[0] as Record<string, unknown>) : null;
    };

    if (receivable.mp_payment_id) {
      for (const token of mpAccessTokens) {
        paymentPayload = await fetchPaymentById(token, String(receivable.mp_payment_id));
        if (paymentPayload) {
          mpAccessToken = token;
          break;
        }
      }
    }

    if (!paymentPayload) {
      for (const token of mpAccessTokens) {
        paymentPayload = await searchPaymentByExternalRef(token);
        if (paymentPayload) {
          mpAccessToken = token;
          break;
        }
      }
    }

    if (!paymentPayload) {
      return new Response(
        JSON.stringify({
          message: "Nenhum pagamento encontrado no Mercado Pago para esta transação.",
          transactionId,
          ticketsEmitted: 0,
        }),
        { status: 200, headers: corsHeaders },
      );
    }

    // Keep token in scope for any later use (webhook uses service role).
    void mpAccessToken;

    const paymentStatus = paymentPayload.status ? String(paymentPayload.status) : null;
    const paymentStatusDetail = paymentPayload.status_detail ? String(paymentPayload.status_detail) : null;
    const mpPaymentId = paymentPayload.id ? String(paymentPayload.id) : null;
    const mpPreferenceId = paymentPayload.order && typeof paymentPayload.order === "object"
      ? String((paymentPayload.order as { id?: string }).id ?? "")
      : (paymentPayload.preference_id ? String(paymentPayload.preference_id) : null);

    const mpFinancials = extractMpPaymentFinancials(paymentPayload);
    const mpMethodFields = extractMpPaymentMethodFields(paymentPayload as Record<string, unknown>);

    const updatePayload: Record<string, unknown> = {
      payment_status: paymentStatus,
      mp_status_detail: paymentStatusDetail,
      mp_payment_id: mpPaymentId,
      mp_preference_id: mpPreferenceId,
      gross_amount: mpFinancials.grossAmount,
      mp_payment_type_id: mpMethodFields.mp_payment_type_id,
      mp_payment_method_id: mpMethodFields.mp_payment_method_id,
      mp_money_release_date: mpMethodFields.mp_money_release_date,
      settlement_funding_type: mpMethodFields.settlement_funding_type,
    };

    // Taxas só existem depois da liquidação. Gravá-las em pagamento não aprovado
    // suja o receivable e contamina os relatórios de comissão.
    if (isMpApproved(paymentStatus)) {
      updatePayload.mp_fee_amount = mpFinancials.mpFeeAmount;
      updatePayload.net_amount_after_mp = mpFinancials.collectorNetAmount;

      const isManualD1 =
        (receivable as { settlement_channel?: string | null }).settlement_channel === "manual_d1" ||
        (receivable as { collector_type?: string | null }).collector_type === "platform";

      if (isManualD1) {
        // Comissão EventFest = % do evento; não usar residual/marketplace_fee do MP.
        let appliedPct = 0;
        const eventId = (receivable as { event_id?: string | null }).event_id;
        if (eventId) {
          const { data: eventRow } = await supabaseService
            .from("events")
            .select("applied_percentage")
            .eq("id", eventId)
            .maybeSingle();
          appliedPct = Number(eventRow?.applied_percentage ?? 0);
        }
        const gross = Number(
          mpFinancials.grossAmount ??
            (receivable as { gross_amount?: number | null }).gross_amount ??
            (receivable as { total_value?: number | null }).total_value ??
            0,
        );
        if (Number.isFinite(appliedPct) && appliedPct > 0 && gross > 0) {
          updatePayload.platform_fee_amount = Math.round(gross * (appliedPct / 100) * 100) / 100;
        }
      } else {
        updatePayload.platform_fee_amount = mpFinancials.platformFeeAmount;
      }

      if (receivable.status !== "paid") {
        updatePayload.status = "paid";
        updatePayload.paid_at = new Date().toISOString();
      }
    }

    await supabaseService.from("receivables").update(updatePayload).eq("id", transactionId);

    await logPaymentEvent({
      transactionId,
      source: "manual_check",
      paymentStatus,
      receivableStatus: receivable.status,
      paymentStatusDetail,
      mpPaymentId,
      mpPreferenceId,
      payload: { stage: "refresh_status_from_mp" },
    });

    let processingTriggered = false;
    let processingResult: string | null = null;
    let processingHttpStatus: number | null = null;
    let ticketsEmitted = 0;
    let ticketsExpected = 0;

    if (isTerminalOrApprovedStatus(paymentStatus) && mpPaymentId) {
      const webhookRun = await triggerWebhookReprocess(mpPaymentId);
      processingTriggered = webhookRun.triggered;
      processingHttpStatus = webhookRun.httpStatus;
      processingResult = webhookRun.result;
    }

    let splitRecorded = false;

    if (isMpApproved(paymentStatus)) {
      const emitResult = await emitReceivableTicketsForPaidPurchase(supabaseService, transactionId);
      ticketsEmitted = emitResult.updated;
      ticketsExpected = emitResult.expected;
      splitRecorded = await ensureFinancialSplit(transactionId);

      const { data: ensurePayload, error: ensureErr } = await supabaseService.rpc(
        "ensure_ticket_d1_settlement_for_receivable",
        { p_receivable_id: transactionId },
      );
      if (ensureErr) {
        console.error("[check-payment-status] ensure_ticket_d1_settlement_for_receivable:", ensureErr);
      } else {
        console.log("[check-payment-status] D+1 ensure:", JSON.stringify(ensurePayload));
      }
    }

    const assignment = await countAssignedTickets(
      supabaseService,
      transactionId,
      receivable.client_user_id as string,
    );

    const { data: refreshedReceivable } = await supabaseService
      .from("receivables")
      .select("status, payment_status")
      .eq("id", transactionId)
      .maybeSingle();

    const requiresAttention =
      isMpApproved(paymentStatus) &&
      (assignment.assigned < assignment.expected ||
        (refreshedReceivable?.status ?? receivable.status) !== "paid" ||
        !splitRecorded);

    if (requiresAttention) {
      await logPaymentEvent({
        transactionId,
        source: "manual_check",
        paymentStatus,
        receivableStatus: refreshedReceivable?.status ?? receivable.status,
        paymentStatusDetail,
        mpPaymentId,
        mpPreferenceId,
        payload: {
          stage: "requires_attention",
          processing_triggered: processingTriggered,
          processing_result: processingResult,
          processing_http_status: processingHttpStatus,
          tickets_emitted: ticketsEmitted,
          tickets_expected: ticketsExpected,
          tickets_assigned: assignment.assigned,
          split_recorded: splitRecorded,
        },
      });
    }

    return new Response(
      JSON.stringify({
        transactionId,
        receivableStatus: refreshedReceivable?.status ?? receivable.status,
        receivablePaymentStatus: refreshedReceivable?.payment_status ?? paymentStatus,
        paymentStatus,
        paymentStatusDetail,
        mpPaymentId,
        mpPreferenceId,
        grossAmount: mpFinancials.grossAmount,
        mpFeeAmount: mpFinancials.mpFeeAmount,
        netAmountAfterMp: mpFinancials.collectorNetAmount,
        processingTriggered,
        processingResult,
        processingHttpStatus,
        ticketsEmitted,
        ticketsExpected,
        ticketsAssigned: assignment.assigned,
        splitRecorded,
        requiresAttention,
      }),
      { status: 200, headers: corsHeaders },
    );
  } catch (error: unknown) {
    console.error("[check-payment-status] Error:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});

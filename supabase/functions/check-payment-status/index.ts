import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const supabaseService = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

function toAmount(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function isTerminalOrApprovedStatus(status: string | null): boolean {
  return status === "approved" || status === "authorized" || status === "rejected" || status === "cancelled";
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
      .select("id, status, payment_status, mp_status_detail, mp_payment_id, mp_preference_id, client_user_id, manager_user_id")
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

    const mpAccessTokenRaw = Deno.env.get("PAYMENT_API_KEY_SECRET");
    if (!mpAccessTokenRaw || mpAccessTokenRaw.trim() === "") {
      return new Response(JSON.stringify({ error: "Payment service not configured (missing PAYMENT_API_KEY_SECRET)." }), {
        status: 500,
        headers: corsHeaders,
      });
    }
    const mpAccessToken = mpAccessTokenRaw.trim();

    let paymentPayload: Record<string, any> | null = null;
    if (receivable.mp_payment_id) {
      const byIdResp = await fetch(`https://api.mercadopago.com/v1/payments/${receivable.mp_payment_id}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${mpAccessToken}`,
          "Content-Type": "application/json",
        },
      });
      if (byIdResp.ok) {
        paymentPayload = await byIdResp.json();
      }
    }

    if (!paymentPayload) {
      const searchResp = await fetch(
        `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(transactionId)}&sort=date_created&criteria=desc&limit=1`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${mpAccessToken}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (!searchResp.ok) {
        const searchText = await searchResp.text();
        return new Response(JSON.stringify({ error: "Falha ao consultar status no Mercado Pago.", details: searchText }), {
          status: 502,
          headers: corsHeaders,
        });
      }

      const searchJson = await searchResp.json();
      const results = Array.isArray(searchJson.results) ? searchJson.results : [];
      paymentPayload = results.length > 0 ? results[0] : null;
    }

    if (!paymentPayload) {
      return new Response(
        JSON.stringify({
          message: "Nenhum pagamento encontrado no Mercado Pago para esta transação.",
          transactionId,
        }),
        { status: 200, headers: corsHeaders },
      );
    }

    const paymentStatus = paymentPayload.status ? String(paymentPayload.status) : null;
    const paymentStatusDetail = paymentPayload.status_detail ? String(paymentPayload.status_detail) : null;
    const mpPaymentId = paymentPayload.id ? String(paymentPayload.id) : null;
    const mpPreferenceId = paymentPayload.order?.id
      ? String(paymentPayload.order.id)
      : (paymentPayload.preference_id ? String(paymentPayload.preference_id) : null);

    const grossAmount = toAmount(paymentPayload.transaction_amount);
    const netAmount = toAmount(paymentPayload.transaction_details?.net_received_amount);
    const feeDetails = Array.isArray(paymentPayload.fee_details) ? paymentPayload.fee_details : [];
    const feeAmount = feeDetails.reduce((sum: number, fee: any) => sum + (toAmount(fee?.amount) ?? 0), 0);
    const mpFeeAmount = feeAmount > 0 ? feeAmount : (grossAmount !== null && netAmount !== null ? Math.max(grossAmount - netAmount, 0) : null);
    const netAfterMp = netAmount ?? (grossAmount !== null && mpFeeAmount !== null ? grossAmount - mpFeeAmount : null);

    await supabaseService
      .from("receivables")
      .update({
        payment_status: paymentStatus,
        mp_status_detail: paymentStatusDetail,
        mp_payment_id: mpPaymentId,
        mp_preference_id: mpPreferenceId,
        gross_amount: grossAmount,
        mp_fee_amount: mpFeeAmount,
        net_amount_after_mp: netAfterMp,
      })
      .eq("id", transactionId);

    let processingTriggered = false;
    let processingResult: string | null = null;
    let processingHttpStatus: number | null = null;

    // Se já está aprovado/rejeitado no MP e o status local ainda não refletiu,
    // disparar reprocessamento usando a própria rotina oficial do webhook.
    if (isTerminalOrApprovedStatus(paymentStatus) && mpPaymentId) {
      const webhookBase = `${Deno.env.get("SUPABASE_URL") ?? ""}/functions/v1/mercadopago-webhook`;
      const webhookUrl = `${webhookBase}?topic=payment&id=${encodeURIComponent(mpPaymentId)}`;
      try {
        const webhookResp = await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "payment",
            data: { id: mpPaymentId },
          }),
        });
        processingTriggered = true;
        processingHttpStatus = webhookResp.status;
        const webhookText = await webhookResp.text().catch(() => "");
        processingResult = webhookResp.ok
          ? "Webhook reprocessado com sucesso."
          : `Webhook retornou ${webhookResp.status}: ${webhookText}`;
      } catch (reprocessError: any) {
        processingTriggered = true;
        processingResult = `Falha ao reprocessar webhook: ${reprocessError?.message || "erro desconhecido"}`;
      }
    }

    const { data: refreshedReceivable } = await supabaseService
      .from("receivables")
      .select("status, payment_status")
      .eq("id", transactionId)
      .maybeSingle();

    const requiresAttention =
      (paymentStatus === "approved" || paymentStatus === "authorized") &&
      (refreshedReceivable?.status ?? receivable.status) !== "paid";

    return new Response(
      JSON.stringify({
        transactionId,
        receivableStatus: refreshedReceivable?.status ?? receivable.status,
        receivablePaymentStatus: refreshedReceivable?.payment_status ?? paymentStatus,
        paymentStatus,
        paymentStatusDetail,
        mpPaymentId,
        mpPreferenceId,
        grossAmount,
        mpFeeAmount,
        netAmountAfterMp: netAfterMp,
        processingTriggered,
        processingResult,
        processingHttpStatus,
        requiresAttention,
      }),
      { status: 200, headers: corsHeaders },
    );
  } catch (error: any) {
    console.error("[check-payment-status] Error:", error);
    return new Response(JSON.stringify({ error: error?.message || "Internal Server Error" }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});


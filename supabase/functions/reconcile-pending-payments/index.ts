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

async function logPaymentEvent(transactionId: string, payload: Record<string, unknown>) {
  await supabaseService.from("payment_events").insert({
    transaction_id: transactionId,
    source: "system",
    payload,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const secret = (Deno.env.get("RECONCILIATION_TOKEN") ?? "").trim();
    const auth = (req.headers.get("x-reconciliation-token") ?? "").trim();
    if (secret && auth !== secret) {
      return new Response(JSON.stringify({ error: "Unauthorized reconciliation token." }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(100, Number(body.limit ?? 30)));
    const olderThanMinutes = Math.max(1, Math.min(120, Number(body.olderThanMinutes ?? 5)));
    const since = new Date(Date.now() - olderThanMinutes * 60 * 1000).toISOString();

    const { data: pendingRows, error: pendingError } = await supabaseService
      .from("receivables")
      .select("id, mp_payment_id")
      .eq("status", "pending")
      .lte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (pendingError) throw pendingError;

    const mpAccessTokenRaw = Deno.env.get("PAYMENT_API_KEY_SECRET");
    if (!mpAccessTokenRaw || mpAccessTokenRaw.trim() === "") {
      return new Response(JSON.stringify({ error: "Payment service not configured." }), {
        status: 500,
        headers: corsHeaders,
      });
    }
    const mpAccessToken = mpAccessTokenRaw.trim();

    let processed = 0;
    let resolved = 0;
    const details: Array<Record<string, unknown>> = [];

    for (const row of pendingRows || []) {
      processed += 1;
      const transactionId = row.id as string;

      let paymentPayload: Record<string, any> | null = null;
      if (row.mp_payment_id) {
        const byIdResp = await fetch(`https://api.mercadopago.com/v1/payments/${row.mp_payment_id}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${mpAccessToken}`,
            "Content-Type": "application/json",
          },
        });
        if (byIdResp.ok) paymentPayload = await byIdResp.json();
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
        if (searchResp.ok) {
          const searchJson = await searchResp.json();
          const results = Array.isArray(searchJson.results) ? searchJson.results : [];
          paymentPayload = results.length > 0 ? results[0] : null;
        }
      }

      if (!paymentPayload) {
        details.push({ transactionId, action: "not_found_on_mp" });
        await logPaymentEvent(transactionId, { stage: "reconcile_not_found_on_mp" });
        continue;
      }

      const paymentStatus = paymentPayload.status ? String(paymentPayload.status) : null;
      const statusDetail = paymentPayload.status_detail ? String(paymentPayload.status_detail) : null;
      const mpPaymentId = paymentPayload.id ? String(paymentPayload.id) : null;
      const mpPreferenceId = paymentPayload.order?.id
        ? String(paymentPayload.order.id)
        : (paymentPayload.preference_id ? String(paymentPayload.preference_id) : null);
      const gross = toAmount(paymentPayload.transaction_amount);
      const net = toAmount(paymentPayload.transaction_details?.net_received_amount);
      const fees = Array.isArray(paymentPayload.fee_details)
        ? paymentPayload.fee_details.reduce((sum: number, f: any) => sum + (toAmount(f?.amount) ?? 0), 0)
        : 0;
      const fee = fees > 0 ? fees : (gross !== null && net !== null ? Math.max(gross - net, 0) : null);
      const netAfterMp = net ?? (gross !== null && fee !== null ? gross - fee : null);

      await supabaseService
        .from("receivables")
        .update({
          payment_status: paymentStatus,
          mp_status_detail: statusDetail,
          mp_payment_id: mpPaymentId,
          mp_preference_id: mpPreferenceId,
          gross_amount: gross,
          mp_fee_amount: fee,
          net_amount_after_mp: netAfterMp,
        })
        .eq("id", transactionId);

      await logPaymentEvent(transactionId, {
        stage: "reconcile_refresh",
        payment_status: paymentStatus,
        payment_status_detail: statusDetail,
      });

      if (paymentStatus === "approved" || paymentStatus === "authorized" || paymentStatus === "rejected" || paymentStatus === "cancelled") {
        const webhookBase = `${Deno.env.get("SUPABASE_URL") ?? ""}/functions/v1/mercadopago-webhook`;
        const webhookUrl = `${webhookBase}?topic=payment&id=${encodeURIComponent(mpPaymentId ?? "")}`;
        const webhookResp = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "payment",
            data: { id: mpPaymentId },
          }),
        });
        resolved += webhookResp.ok ? 1 : 0;
        details.push({
          transactionId,
          action: "webhook_reprocess",
          paymentStatus,
          webhookStatus: webhookResp.status,
        });
        await logPaymentEvent(transactionId, {
          stage: "reconcile_webhook_reprocess",
          payment_status: paymentStatus,
          webhook_status: webhookResp.status,
        });
      } else {
        details.push({ transactionId, action: "still_pending_on_mp", paymentStatus });
      }
    }

    return new Response(
      JSON.stringify({
        message: "Reconciliação concluída.",
        processed,
        resolved,
        olderThanMinutes,
        details,
      }),
      { status: 200, headers: corsHeaders },
    );
  } catch (error: any) {
    console.error("[reconcile-pending-payments] Error:", error);
    return new Response(JSON.stringify({ error: error?.message || "Internal Server Error" }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});


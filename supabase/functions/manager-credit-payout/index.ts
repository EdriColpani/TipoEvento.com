import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-idempotency-key',
  'Content-Type': 'application/json',
};

/**
 * Repasse automático via Mercado Pago (advanced_payments) foi descontinuado.
 * Liquidação manual D+1: Admin Master registra TED/PIX em register_admin_credit_settlement_payment.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({
      error: 'Repasse automático Mercado Pago descontinuado.',
      code: 'MP_DISBURSEMENT_DEPRECATED',
      message:
        'Use liquidação manual D+1 (TED/PIX) no painel Admin → Créditos → Settlements.',
      settlement_mode: 'manual_d1',
    }),
    { status: 410, headers: corsHeaders },
  );
});

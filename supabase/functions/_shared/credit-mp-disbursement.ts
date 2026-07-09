import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

export type SpendRpcPayload = {
  ok?: boolean;
  duplicate?: boolean;
  spend_order_id?: string;
  receiver_company_id?: string;
  gross_amount?: number;
  platform_amount?: number;
  manager_amount?: number;
  balance?: number;
  public_description?: string;
  settlementQueued?: boolean;
};

/**
 * Finaliza consumo com crédito EventFest sem repasse automático MP.
 * O trigger em credit_financial_splits grava pendência D+1 em manager_credit_settlement_ledger.
 * Liquidação manual (TED/PIX) é feita pelo Admin Master.
 */
export async function finalizeCreditSpendWithMpDisbursement(
  supabaseService: SupabaseClient,
  spendPayload: SpendRpcPayload,
  _idempotencyKey?: string,
  _description?: string,
): Promise<SpendRpcPayload & { mpTransferId?: string }> {
  if (!spendPayload?.ok || !spendPayload.spend_order_id) {
    throw new Error('Resposta de spend inválida.');
  }

  const managerAmount = Number(spendPayload.manager_amount ?? 0);
  if (managerAmount > 0) {
    const { data: ledgerRow, error: ledgerErr } = await supabaseService
      .from('manager_credit_settlement_ledger')
      .select('id, status, release_at')
      .eq('spend_order_id', spendPayload.spend_order_id)
      .maybeSingle();

    if (ledgerErr) {
      console.warn('[credit-settlement] ledger lookup:', ledgerErr.message);
    } else if (!ledgerRow?.id) {
      console.warn(
        '[credit-settlement] split sem linha em manager_credit_settlement_ledger — spend',
        spendPayload.spend_order_id,
      );
    }
  }

  return {
    ...spendPayload,
    settlementQueued: managerAmount > 0,
  };
}

/** @deprecated MP automático descontinuado — mantido para compatibilidade de import. */
export async function executeCreditMpDisbursement(): Promise<never> {
  throw new Error('Repasse automático Mercado Pago descontinuado. Use liquidação manual D+1.');
}

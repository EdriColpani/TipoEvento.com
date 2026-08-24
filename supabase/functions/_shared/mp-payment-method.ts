/** Normalização do meio de pagamento MP → prazo de repasse (regra v0.2). */

export type SettlementFundingType = 'credit_card' | 'debit_card' | 'pix' | 'other';

export type MpPaymentMethodFields = {
  mp_payment_type_id: string | null;
  mp_payment_method_id: string | null;
  mp_money_release_date: string | null;
  settlement_funding_type: SettlementFundingType | null;
};

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

/** Extrai money_release_date do payload do pagamento MP (ISO ou null). */
export function extractMpMoneyReleaseDate(mpPayment: Record<string, unknown>): string | null {
  const raw =
    mpPayment.money_release_date ??
    mpPayment.money_release_date_iso ??
    (mpPayment as { transaction_details?: Record<string, unknown> }).transaction_details
      ?.money_release_date;

  if (raw == null) return null;
  if (typeof raw === 'string' && raw.trim()) {
    const d = new Date(raw);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  return null;
}

export function normalizeMpSettlementFundingType(
  paymentTypeId: string | null | undefined,
  paymentMethodId: string | null | undefined,
): SettlementFundingType | null {
  const type = (paymentTypeId ?? '').trim().toLowerCase();
  const method = (paymentMethodId ?? '').trim().toLowerCase();

  if (method === 'pix' || method.includes('pix')) return 'pix';
  if (type === 'credit_card' || type === 'credit') return 'credit_card';
  if (type === 'debit_card' || type === 'debit') return 'debit_card';
  if (type === 'bank_transfer' || type === 'account_money' || type === 'digital_currency') {
    return 'pix';
  }
  if (!type && !method) return null;
  return 'other';
}

/** Campos para gravar em receivables / credit_topup_orders a partir do payment MP. */
export function extractMpPaymentMethodFields(
  mpPayment: Record<string, unknown>,
): MpPaymentMethodFields {
  const typeId = asTrimmedString(mpPayment.payment_type_id);
  const methodId = asTrimmedString(mpPayment.payment_method_id);
  const moneyRelease = extractMpMoneyReleaseDate(mpPayment);
  const funding = normalizeMpSettlementFundingType(typeId, methodId);

  return {
    mp_payment_type_id: typeId,
    mp_payment_method_id: methodId,
    mp_money_release_date: moneyRelease,
    settlement_funding_type: funding,
  };
}

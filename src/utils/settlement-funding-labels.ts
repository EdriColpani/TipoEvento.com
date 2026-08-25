/** Labels de meio/prazo de repasse (regra v0.2). */

export type SettlementFundingType =
  | 'credit_card'
  | 'debit_card'
  | 'pix'
  | 'other'
  | string
  | null
  | undefined;

export const SETTLEMENT_POLICY_SHORT =
  'PIX/débito D+1 · cartão D+30 (ou data MP)';

export const SETTLEMENT_POLICY_HELP =
  'O cliente usa na hora. O repasse ao gestor segue o meio: PIX e débito em D+1; cartão de crédito na data de liberação do Mercado Pago quando for prazo real (senão D+30).';

export function settlementFundingLabel(type: SettlementFundingType): string {
  switch (type) {
    case 'credit_card':
      return 'Cartão de crédito';
    case 'debit_card':
      return 'Cartão de débito';
    case 'pix':
      return 'PIX';
    case 'other':
      return 'Outro';
    default:
      return '—';
  }
}

/** Normaliza type/method MP → funding (espelha edge `_shared/mp-payment-method`). */
export function normalizeSettlementFundingType(
  paymentTypeId?: string | null,
  paymentMethodId?: string | null,
): SettlementFundingType {
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

/**
 * Label da coluna “Tipo da compra” no Relatório Financeiro
 * (cartão / PIX / débito / crédito EventFest).
 */
export function purchasePaymentMethodLabel(row: {
  payment_gateway_id?: string | null;
  settlement_funding_type?: string | null;
  mp_payment_type_id?: string | null;
  mp_payment_method_id?: string | null;
  split_source?: 'mp' | 'credit' | null;
}): string {
  const gateway = row.payment_gateway_id ?? '';
  if (row.split_source === 'credit' || gateway.startsWith('eventfest_credit:')) {
    return 'Crédito EventFest';
  }
  const funding =
    (row.settlement_funding_type && String(row.settlement_funding_type).trim()) ||
    normalizeSettlementFundingType(row.mp_payment_type_id, row.mp_payment_method_id);
  return settlementFundingLabel(funding);
}

/** Prazo comercial associado ao meio (não substitui a coluna release_at). */
export function settlementFundingDelayHint(
  type: SettlementFundingType,
  delayDays?: number | null,
): string {
  if (type === 'credit_card') {
    if (delayDays == null) return 'Data MP / D+30';
    return `D+${delayDays}`;
  }
  if (type === 'pix' || type === 'debit_card') return 'D+1';
  if (delayDays != null && delayDays > 0) return `D+${delayDays}`;
  return 'D+1';
}

export function settlementFundingBucket(
  type: SettlementFundingType,
): 'card' | 'fast' {
  return type === 'credit_card' ? 'card' : 'fast';
}

export type SettlementFundingFilter = 'all' | 'fast' | 'card';

export function matchesSettlementFundingFilter(
  type: SettlementFundingType,
  filter: SettlementFundingFilter,
): boolean {
  if (filter === 'all') return true;
  return settlementFundingBucket(type) === filter;
}

export function settlementSourceOriginLabel(
  sourceType: string | null | undefined,
): string {
  return sourceType === 'ticket' ? 'Ingresso' : 'Crédito';
}

export function settlementStatusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: 'Em retenção',
    released: 'Aguardando TED/PIX EventFest',
    paid: 'Pago',
    clawback: 'Clawback',
    cancelled: 'Cancelado',
  };
  return map[status] ?? status;
}

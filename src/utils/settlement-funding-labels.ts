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
  'O cliente usa na hora. O repasse ao gestor segue o meio: PIX e débito em D+1; cartão de crédito na data de liberação do Mercado Pago (ou D+30 se a data não vier).';

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

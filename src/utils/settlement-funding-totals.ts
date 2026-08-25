import type { SettlementFundingSummary } from '@/hooks/use-credit-reports';
import {
  settlementFundingBucket,
  type SettlementFundingType,
} from '@/utils/settlement-funding-labels';

export type SettlementFundingTotals = {
  awaitingFast: number;
  awaitingCard: number;
  retentionFast: number;
  retentionCard: number;
  paidFast: number;
  paidCard: number;
};

export function emptySettlementFundingTotals(): SettlementFundingTotals {
  return {
    awaitingFast: 0,
    awaitingCard: 0,
    retentionFast: 0,
    retentionCard: 0,
    paidFast: 0,
    paidCard: 0,
  };
}

export function fundingTotalsFromSummary(
  summary?: SettlementFundingSummary | null,
): SettlementFundingTotals {
  return {
    awaitingFast: Number(summary?.awaiting_payment_fast ?? 0),
    awaitingCard: Number(summary?.awaiting_payment_card ?? 0),
    retentionFast: Number(summary?.pending_retention_fast ?? 0),
    retentionCard: Number(summary?.pending_retention_card ?? 0),
    paidFast: Number(summary?.paid_fast ?? 0),
    paidCard: Number(summary?.paid_card ?? 0),
  };
}

/** Soma itens de ledger por meio (PIX/débito vs cartão) e status. */
export function sumSettlementItemsByFunding(
  items: Array<{
    manager_amount?: number | null;
    status?: string | null;
    settlement_funding_type?: SettlementFundingType;
  }>,
): SettlementFundingTotals {
  const totals = emptySettlementFundingTotals();
  for (const item of items) {
    const amt = Number(item.manager_amount ?? 0);
    if (!Number.isFinite(amt) || amt === 0) continue;
    const isCard = settlementFundingBucket(item.settlement_funding_type) === 'card';
    const status = String(item.status ?? '');
    if (status === 'released') {
      if (isCard) totals.awaitingCard += amt;
      else totals.awaitingFast += amt;
    } else if (status === 'pending') {
      if (isCard) totals.retentionCard += amt;
      else totals.retentionFast += amt;
    } else if (status === 'paid') {
      if (isCard) totals.paidCard += amt;
      else totals.paidFast += amt;
    }
  }
  return totals;
}

export function awaitingTotal(t: SettlementFundingTotals): number {
  return t.awaitingFast + t.awaitingCard;
}

export function retentionTotal(t: SettlementFundingTotals): number {
  return t.retentionFast + t.retentionCard;
}

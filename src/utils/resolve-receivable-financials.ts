/** Consolida financial_splits e alinha totais ao extrato / tabela de transações. */

export type FinancialSplitRow = {
  transaction_id: string;
  platform_amount?: number | null;
  manager_amount?: number | null;
  applied_percentage?: number | null;
};

export type ConsolidatedSplit = {
  system_commission_amount: number;
  organizer_net_amount: number;
  system_commission_percentage: number | null;
};

/** Prefixo gravado em receivables.payment_gateway_id nas compras pagas com crédito EventFest. */
const CREDIT_GATEWAY_PREFIX = 'eventfest_credit:';

/** Id da ordem de consumo quando a compra foi paga com crédito da carteira; senão null. */
export function extractCreditSpendOrderId(paymentGatewayId: string | null | undefined): string | null {
  if (!paymentGatewayId || !paymentGatewayId.startsWith(CREDIT_GATEWAY_PREFIX)) return null;
  return paymentGatewayId.slice(CREDIT_GATEWAY_PREFIX.length) || null;
}

export function consolidateSplitsByTransaction(
  splits: FinancialSplitRow[],
): Map<string, ConsolidatedSplit> {
  const map = new Map<string, ConsolidatedSplit>();

  for (const split of splits) {
    const key = split.transaction_id;
    if (!map.has(key)) {
      map.set(key, {
        system_commission_amount: 0,
        organizer_net_amount: 0,
        system_commission_percentage: null,
      });
    }
    const acc = map.get(key)!;
    acc.system_commission_amount = Math.max(
      acc.system_commission_amount,
      Number(split.platform_amount ?? 0),
    );
    acc.organizer_net_amount = Math.max(
      acc.organizer_net_amount,
      Number(split.manager_amount ?? 0),
    );
    if (split.applied_percentage !== null && split.applied_percentage !== undefined) {
      acc.system_commission_percentage = Number(split.applied_percentage);
    }
  }

  return map;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function resolveReceivableFinancials(
  receivable: {
    gross_amount?: number | null;
    total_value?: number | null;
    mp_fee_amount?: number | null;
    net_amount_after_mp?: number | null;
    platform_fee_amount?: number | null;
    settlement_channel?: string | null;
    collector_type?: string | null;
  },
  split: ConsolidatedSplit | undefined,
  eventAppliedPercentage: number | null,
): { gross: number; organizerNet: number; systemCommission: number; appliedPercentage: number | null } {
  const gross = Number(receivable.gross_amount ?? receivable.total_value ?? 0);
  const fee = Number(receivable.mp_fee_amount ?? 0);
  const netMp = Number(
    receivable.net_amount_after_mp ?? Math.max(gross - fee, 0),
  );
  const appliedPercentage =
    split?.system_commission_percentage !== null &&
    split?.system_commission_percentage !== undefined
      ? split.system_commission_percentage
      : eventAppliedPercentage;

  // Modo banco (EventFest cobra): comissão = % do evento, não residual/marketplace_fee do MP.
  const isManualD1 =
    receivable.settlement_channel === 'manual_d1' ||
    receivable.collector_type === 'platform';
  if (isManualD1 && appliedPercentage !== null && gross > 0) {
    const systemCommission = roundMoney(gross * (appliedPercentage / 100));
    const organizerNet = Math.max(roundMoney(gross - fee - systemCommission), 0);
    return { gross, organizerNet, systemCommission, appliedPercentage };
  }

  const platformFeeStored = Number(receivable.platform_fee_amount ?? 0);
  const fallbackSystemCommission =
    platformFeeStored > 0
      ? platformFeeStored
      : appliedPercentage !== null && gross > 0
        ? roundMoney(gross * (appliedPercentage / 100))
        : 0;
  const fallbackOrganizerNet =
    netMp > 0 ? netMp : Math.max(roundMoney(gross - fee - fallbackSystemCommission), 0);

  const systemCommission =
    split && split.system_commission_amount > 0
      ? split.system_commission_amount
      : fallbackSystemCommission;
  const organizerNet =
    split && split.organizer_net_amount > 0
      ? split.organizer_net_amount
      : fallbackOrganizerNet;

  return { gross, organizerNet, systemCommission, appliedPercentage };
}

/**
 * Receita líquida do gestor para o dashboard: bruto − comissão da plataforma.
 * Quando a comissão existe, força a subtração (alguns splits antigos gravavam
 * manager_amount = bruto).
 */
export function managerLiquidRevenue(
  receivable: {
    gross_amount?: number | null;
    total_value?: number | null;
    mp_fee_amount?: number | null;
    net_amount_after_mp?: number | null;
    platform_fee_amount?: number | null;
  },
  split: ConsolidatedSplit | undefined,
): number {
  const resolved = resolveReceivableFinancials(receivable, split, null);
  if (resolved.systemCommission > 0) {
    return Math.max(0, resolved.gross - resolved.systemCommission);
  }
  return resolved.organizerNet > 0 ? resolved.organizerNet : resolved.gross;
}

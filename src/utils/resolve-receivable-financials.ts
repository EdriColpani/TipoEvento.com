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

export function resolveReceivableFinancials(
  receivable: {
    gross_amount?: number | null;
    total_value?: number | null;
    mp_fee_amount?: number | null;
    net_amount_after_mp?: number | null;
    platform_fee_amount?: number | null;
  },
  split: ConsolidatedSplit | undefined,
  eventAppliedPercentage: number | null,
): { gross: number; organizerNet: number; systemCommission: number; appliedPercentage: number | null } {
  const gross = Number(receivable.gross_amount ?? receivable.total_value ?? 0);
  const fee = Number(receivable.mp_fee_amount ?? 0);
  const netMp = Number(
    receivable.net_amount_after_mp ?? Math.max(gross - fee, 0),
  );
  const platformFeeStored = Number(receivable.platform_fee_amount ?? 0);
  const fallbackSystemCommission =
    platformFeeStored > 0
      ? platformFeeStored
      : eventAppliedPercentage !== null && gross > 0
        ? gross * (eventAppliedPercentage / 100)
        : 0;
  const fallbackOrganizerNet =
    netMp > 0 ? netMp : Math.max(gross - fee - fallbackSystemCommission, 0);

  const systemCommission =
    split && split.system_commission_amount > 0
      ? split.system_commission_amount
      : fallbackSystemCommission;
  const organizerNet =
    split && split.organizer_net_amount > 0
      ? split.organizer_net_amount
      : fallbackOrganizerNet;
  const appliedPercentage =
    split?.system_commission_percentage !== null &&
    split?.system_commission_percentage !== undefined
      ? split.system_commission_percentage
      : eventAppliedPercentage;

  return { gross, organizerNet, systemCommission, appliedPercentage };
}

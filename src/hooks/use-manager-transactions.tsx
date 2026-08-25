import { useQuery } from '@tanstack/react-query';
import {
  consolidateSplitsByTransaction,
  extractCreditSpendOrderId,
  resolveReceivableFinancials,
  type ConsolidatedSplit,
} from '@/utils/resolve-receivable-financials';
import {
  fetchCreditSplitsRest,
  fetchFinancialSplitsRest,
  fetchReceivablesRest,
} from '@/utils/fetch-receivables-rest';
import { purchasePaymentMethodLabel } from '@/utils/settlement-funding-labels';

export interface ManagerTransactionData {
  id: string;
  status: 'pending' | 'paid' | 'failed';
  payment_status: string | null;
  mp_status_detail: string | null;
  mp_payment_id: string | null;
  payment_gateway_id?: string | null;
  total_value: number;
  gross_amount: number | null;
  mp_fee_amount: number | null;
  mp_fee_percentage: number | null;
  net_amount_after_mp: number | null;
  system_commission_percentage: number | null;
  system_commission_amount: number | null;
  organizer_net_amount: number | null;
  /** true quando o split foi gravado (comissão + líquido gestor). */
  split_recorded: boolean;
  /** 'mp' = split Mercado Pago; 'credit' = pago com crédito EventFest. */
  split_source: 'mp' | 'credit' | null;
  /** Meio da compra: cartão / PIX / débito / crédito EventFest. */
  purchase_method_label: string;
  settlement_funding_type?: string | null;
  mp_payment_type_id?: string | null;
  mp_payment_method_id?: string | null;
  settlement_channel?: string | null;
  collector_type?: string | null;
  created_at: string;
  paid_at: string | null;
  events: {
    id: string;
    title: string;
    date: string;
  } | null;
}

export interface ManagerTransactionFilters {
  eventId?: string;
  startDate?: string;
  endDate?: string;
  status?: 'pending' | 'paid' | 'failed';
}

const fetchManagerTransactions = async (
  userId: string,
  isAdminMaster: boolean,
  filters: ManagerTransactionFilters = {},
): Promise<ManagerTransactionData[]> => {
  const data = await fetchReceivablesRest(filters, userId, isAdminMaster, {
    limit: 100,
    orderDesc: true,
  });

  const transactionIds = data.map((row) => row.id);

  // Compra paga com crédito EventFest não gera financial_splits: o split fica em
  // credit_financial_splits, indexado pelo id da ordem de consumo.
  const creditOrderByTransaction = new Map<string, string>();
  for (const row of data) {
    const orderId = extractCreditSpendOrderId(row.payment_gateway_id);
    if (orderId) creditOrderByTransaction.set(row.id, orderId);
  }

  const [splits, creditSplits] = await Promise.all([
    fetchFinancialSplitsRest(transactionIds),
    fetchCreditSplitsRest([...new Set(creditOrderByTransaction.values())]),
  ]);

  const splitByTransaction = consolidateSplitsByTransaction(splits);
  const creditSplitByOrder = new Map<string, ConsolidatedSplit>(
    creditSplits.map((row) => [
      row.spend_order_id,
      {
        system_commission_amount: Number(row.platform_amount ?? 0),
        organizer_net_amount: Number(row.manager_amount ?? 0),
        system_commission_percentage:
          row.applied_percentage !== null && row.applied_percentage !== undefined
            ? Number(row.applied_percentage)
            : null,
      },
    ]),
  );

  return data.map((row) => {
    const gross = typeof row.gross_amount === 'number' ? row.gross_amount : Number(row.gross_amount ?? row.total_value ?? 0);
    const fee = typeof row.mp_fee_amount === 'number' ? row.mp_fee_amount : Number(row.mp_fee_amount ?? 0);
    const netMp = typeof row.net_amount_after_mp === 'number'
      ? row.net_amount_after_mp
      : Number(row.net_amount_after_mp ?? Math.max(gross - fee, 0));
    const mp_fee_percentage = gross > 0 ? (fee / gross) * 100 : null;
    const eventPct =
      row.events?.applied_percentage !== null && row.events?.applied_percentage !== undefined
        ? Number(row.events.applied_percentage)
        : null;
    const creditOrderId = creditOrderByTransaction.get(row.id);
    const split =
      splitByTransaction.get(row.id) ??
      (creditOrderId ? creditSplitByOrder.get(creditOrderId) : undefined);
    const resolved = resolveReceivableFinancials(row, split, eventPct);
    const splitRecorded = Boolean(
      split &&
        (split.system_commission_amount > 0 || split.organizer_net_amount > 0),
    );

    return {
      ...row,
      status: row.status as ManagerTransactionData['status'],
      net_amount_after_mp: netMp,
      mp_fee_percentage,
      system_commission_percentage: resolved.appliedPercentage,
      system_commission_amount: resolved.systemCommission,
      organizer_net_amount: resolved.organizerNet,
      split_recorded: splitRecorded,
      split_source: splitRecorded ? (creditOrderId ? 'credit' : 'mp') : null,
      purchase_method_label: purchasePaymentMethodLabel({
        payment_gateway_id: row.payment_gateway_id,
        settlement_funding_type: row.settlement_funding_type,
        mp_payment_type_id: row.mp_payment_type_id,
        mp_payment_method_id: row.mp_payment_method_id,
        split_source: creditOrderId ? 'credit' : null,
      }),
    };
  });
};

export const useManagerTransactions = (
  userId: string | undefined,
  isAdminMaster: boolean,
  filters: ManagerTransactionFilters = {},
  options?: { enabled?: boolean },
) => {
  const enabled =
    options?.enabled !== undefined ? options.enabled : Boolean(userId);

  const query = useQuery({
    queryKey: ['managerTransactions', userId, isAdminMaster, filters],
    queryFn: () => fetchManagerTransactions(userId!, isAdminMaster, filters),
    enabled,
    staleTime: 30_000,
    retry: 1,
  });

  return {
    ...query,
    transactions: query.data || [],
  };
};

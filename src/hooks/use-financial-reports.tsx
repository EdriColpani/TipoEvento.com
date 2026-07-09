import { useQuery } from '@tanstack/react-query';
import {
    consolidateSplitsByTransaction,
    resolveReceivableFinancials,
} from '@/utils/resolve-receivable-financials';
import {
    fetchFinancialSplitsRest,
    fetchPaidReceivablesForReport,
} from '@/utils/fetch-receivables-rest';

export interface FinancialReportData {
    event_id: string;
    event_title: string;
    event_date: string;
    quantidade_vendas: number;
    quantidade_ingressos_vendidos: number;
    valor_total_vendido: number;
    /** Soma do "Recebido gestor" por transação (alinhado à tabela de transações). */
    valor_liquido_organizador: number;
    comissao_total_sistema: number;
    percentual_comissao_medio: number;
}

export interface FinancialReportFilters {
    eventId?: string;
    startDate?: string;
    endDate?: string;
}

const fetchFinancialReports = async (
    filters: FinancialReportFilters = {},
    userId?: string,
    isAdminMaster: boolean = false,
): Promise<FinancialReportData[]> => {
    const receivables = await fetchPaidReceivablesForReport(filters, userId, isAdminMaster);
    if (receivables.length === 0) return [];

    const eventMap = new Map<string, {
        event_id: string;
        event_title: string;
        event_date: string;
        receivables: typeof receivables;
    }>();

    receivables.forEach((r) => {
        const eventId = r.event_id;
        if (!eventMap.has(eventId)) {
            eventMap.set(eventId, {
                event_id: eventId,
                event_title: r.events?.title || 'Evento sem nome',
                event_date: r.events?.date || '',
                receivables: [],
            });
        }
        eventMap.get(eventId)!.receivables.push(r);
    });

    const transactionIds = receivables.map((r) => r.id);
    const financialSplits = await fetchFinancialSplitsRest(transactionIds);
    const splitByTransaction = consolidateSplitsByTransaction(financialSplits);

    const reportData: FinancialReportData[] = [];

    eventMap.forEach((eventData, eventId) => {
        const eventTransactions = eventData.receivables;

        let valorTotalVendido = 0;
        let valorLiquidoOrganizador = 0;
        let comissaoTotalSistema = 0;

        for (const t of eventTransactions) {
            const eventPct =
                t.events?.applied_percentage !== null &&
                t.events?.applied_percentage !== undefined
                    ? Number(t.events.applied_percentage)
                    : null;
            const resolved = resolveReceivableFinancials(
                t,
                splitByTransaction.get(t.id),
                eventPct,
            );
            valorTotalVendido += resolved.gross;
            valorLiquidoOrganizador += resolved.organizerNet;
            comissaoTotalSistema += resolved.systemCommission;
        }

        const percentualMedio =
            valorTotalVendido > 0
                ? (comissaoTotalSistema / valorTotalVendido) * 100
                : 0;

        const quantidadeIngressosVendidos = eventTransactions.reduce((sum, t) => {
            const analyticsIds = t.wristband_analytics_ids || [];
            return sum + analyticsIds.length;
        }, 0);

        reportData.push({
            event_id: eventId,
            event_title: eventData.event_title,
            event_date: eventData.event_date,
            quantidade_vendas: eventTransactions.length,
            quantidade_ingressos_vendidos: quantidadeIngressosVendidos,
            valor_total_vendido: valorTotalVendido,
            valor_liquido_organizador: valorLiquidoOrganizador,
            comissao_total_sistema: comissaoTotalSistema,
            percentual_comissao_medio: percentualMedio,
        });
    });

    return reportData.sort((a, b) => b.valor_total_vendido - a.valor_total_vendido);
};

export const useFinancialReports = (
    filters: FinancialReportFilters = {},
    userId?: string,
    isAdminMaster: boolean = false,
    options?: { enabled?: boolean },
) => {
    const enabled =
        options?.enabled !== undefined
            ? options.enabled
            : Boolean(userId && (isAdminMaster || !!userId));

    return useQuery({
        queryKey: ['financial-reports', filters, userId, isAdminMaster],
        queryFn: () => fetchFinancialReports(filters, userId, isAdminMaster),
        enabled,
        staleTime: 30_000,
        retry: 1,
    });
};

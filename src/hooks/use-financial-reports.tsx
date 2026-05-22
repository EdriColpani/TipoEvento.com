import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
    consolidateSplitsByTransaction,
    resolveReceivableFinancials,
} from '@/utils/resolve-receivable-financials';

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
    let query = supabase
        .from('receivables')
        .select(`
            id,
            total_value,
            gross_amount,
            mp_fee_amount,
            net_amount_after_mp,
            platform_fee_amount,
            created_at,
            event_id,
            wristband_analytics_ids,
            events!inner (
                id,
                title,
                date,
                applied_percentage
            )
        `);

    if (!isAdminMaster && userId) {
        query = query.eq('manager_user_id', userId);
    }

    if (filters.eventId) {
        query = query.eq('event_id', filters.eventId);
    }

    if (filters.startDate) {
        query = query.gte('created_at', filters.startDate);
    }
    if (filters.endDate) {
        const endDateWithTime = new Date(filters.endDate);
        endDateWithTime.setHours(23, 59, 59, 999);
        query = query.lte('created_at', endDateWithTime.toISOString());
    }

    const { data: receivables, error: receivablesError } = await query.or(
        'status.eq.paid,payment_status.eq.approved,payment_status.eq.authorized',
    );

    if (receivablesError) throw receivablesError;
    if (!receivables) return [];

    const eventMap = new Map<string, {
        event_id: string;
        event_title: string;
        event_date: string;
        receivables: any[];
    }>();

    receivables.forEach((r: any) => {
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

    const transactionIds = receivables.map((r: any) => r.id);

    const { data: financialSplits, error: splitsError } = await supabase
        .from('financial_splits')
        .select('transaction_id, platform_amount, manager_amount, applied_percentage')
        .in('transaction_id', transactionIds);

    if (splitsError) throw splitsError;

    const splitByTransaction = consolidateSplitsByTransaction(financialSplits || []);

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

        const quantidadeIngressosVendidos = eventTransactions.reduce((sum: number, t: any) => {
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
    });
};

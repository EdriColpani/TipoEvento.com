import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface FinancialReportData {
    event_id: string;
    event_title: string;
    event_date: string;
    quantidade_vendas: number;
    quantidade_ingressos_vendidos: number;
    valor_total_vendido: number;
    valor_liquido_organizador: number;
    comissao_total_sistema: number;
    percentual_comissao_medio: number;
}

export interface FinancialReportFilters {
    eventId?: string;
    startDate?: string;
    endDate?: string;
}

const fetchFinancialReports = async (filters: FinancialReportFilters = {}): Promise<FinancialReportData[]> => {
    let query = supabase
        .from('receivables')
        .select(`
            id,
            total_value,
            created_at,
            event_id,
            wristband_analytics_ids,
            events!inner (
                id,
                title,
                date
            )
        `)
        .eq('status', 'paid');

    // Aplicar filtro de evento
    if (filters.eventId) {
        query = query.eq('event_id', filters.eventId);
    }

    // Aplicar filtro de data
    if (filters.startDate) {
        query = query.gte('created_at', filters.startDate);
    }
    if (filters.endDate) {
        // Adicionar 23:59:59 ao final do dia
        const endDateWithTime = new Date(filters.endDate);
        endDateWithTime.setHours(23, 59, 59, 999);
        query = query.lte('created_at', endDateWithTime.toISOString());
    }

    const { data: receivables, error: receivablesError } = await query;

    if (receivablesError) throw receivablesError;
    if (!receivables) return [];

    // Agrupar por evento e calcular totais
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

    // Buscar financial_splits para cada transação
    const transactionIds = receivables.map((r: any) => r.id);
    
    const { data: financialSplits, error: splitsError } = await supabase
        .from('financial_splits')
        .select('transaction_id, platform_amount, manager_amount, applied_percentage')
        .in('transaction_id', transactionIds);

    if (splitsError) throw splitsError;

    // Contar ingressos vendidos diretamente dos receivables (wristband_analytics_ids é um array)
    // Não precisamos buscar analytics separadamente, podemos contar o tamanho do array

    // Calcular totais por evento
    const reportData: FinancialReportData[] = [];

    eventMap.forEach((eventData, eventId) => {
        const eventTransactions = eventData.receivables;
        const eventTransactionIds = eventTransactions.map((t: any) => t.id);

        // Calcular valores financeiros
        const eventSplits = financialSplits?.filter(fs => eventTransactionIds.includes(fs.transaction_id)) || [];
        
        const valorTotalVendido = eventTransactions.reduce((sum: number, t: any) => sum + (t.total_value || 0), 0);
        const valorLiquidoOrganizador = eventSplits
            .filter(fs => fs.manager_amount > 0)
            .reduce((sum: number, fs: any) => sum + (fs.manager_amount || 0), 0);
        const comissaoTotalSistema = eventSplits
            .filter(fs => fs.platform_amount > 0)
            .reduce((sum: number, fs: any) => sum + (fs.platform_amount || 0), 0);
        
        const percentuais = eventSplits
            .filter(fs => fs.platform_amount > 0 && fs.applied_percentage)
            .map(fs => fs.applied_percentage);
        const percentualMedio = percentuais.length > 0
            ? percentuais.reduce((sum, p) => sum + p, 0) / percentuais.length
            : 0;

        // Contar ingressos vendidos (somar o tamanho dos arrays wristband_analytics_ids de cada transação)
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

export const useFinancialReports = (filters: FinancialReportFilters = {}) => {
    return useQuery({
        queryKey: ['financial-reports', filters],
        queryFn: () => fetchFinancialReports(filters),
    });
};


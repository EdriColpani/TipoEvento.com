import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, Building2 } from 'lucide-react';
import {
    getBillingPlanLabel,
    type BillingPlanCode,
} from '@/constants/billing-plans';
import type { ManagerNotificationItem } from '@/hooks/use-manager-notifications';
import { restGet } from '@/utils/supabase-rest';

const LOOKBACK_DAYS = 14;

type CompanyRow = {
    id: string;
    corporate_name: string | null;
    trade_name: string | null;
    billing_plan: string | null;
    created_at: string;
};

type PlanHistoryRow = {
    id: string;
    company_id: string;
    from_plan: string | null;
    to_plan: string;
    change_type: string;
    created_at: string;
    companies:
        | { corporate_name: string | null; trade_name: string | null }
        | { corporate_name: string | null; trade_name: string | null }[]
        | null;
};

function companyDisplayName(
    trade: string | null | undefined,
    corporate: string | null | undefined,
): string {
    const name = (trade || corporate || '').trim();
    return name || 'Empresa';
}

function unwrapCompany(
    companies: PlanHistoryRow['companies'],
): { trade_name: string | null; corporate_name: string | null } {
    if (!companies) return { trade_name: null, corporate_name: null };
    if (Array.isArray(companies)) {
        return {
            trade_name: companies[0]?.trade_name ?? null,
            corporate_name: companies[0]?.corporate_name ?? null,
        };
    }
    return {
        trade_name: companies.trade_name,
        corporate_name: companies.corporate_name,
    };
}

function changeTypeLabel(changeType: string): string {
    const map: Record<string, string> = {
        upgrade: 'upgrade',
        admin_change: 'alteração admin',
        admin_downgrade: 'downgrade admin',
        reacceptance: 'reaceitação de contrato',
        initial: 'adesão inicial',
    };
    return map[changeType] ?? changeType;
}

/** Notificações só gerenciais para Admin Master (empresas / planos). */
export async function fetchAdminManagerialNotifications(): Promise<ManagerNotificationItem[]> {
    const since = new Date();
    since.setDate(since.getDate() - LOOKBACK_DAYS);
    const sinceIso = since.toISOString();
    const items: Array<ManagerNotificationItem & { sortAt: string }> = [];

    try {
        const companies = await restGet<CompanyRow[]>(
            [
                'companies?select=id,corporate_name,trade_name,billing_plan,created_at',
                `created_at=gte.${encodeURIComponent(sinceIso)}`,
                'order=created_at.desc',
                'limit=20',
            ].join('&'),
            10_000,
        );

        for (const c of companies ?? []) {
            const name = companyDisplayName(c.trade_name, c.corporate_name);
            const planLabel = getBillingPlanLabel(c.billing_plan as BillingPlanCode | null);
            items.push({
                id: `company_joined:${c.id}`,
                type: 'company_joined',
                title: 'Nova empresa aderiu',
                message: planLabel
                    ? `${name} entrou na plataforma no plano ${planLabel}.`
                    : `${name} entrou na plataforma.`,
                link: '/admin/settings/companies-billing',
                icon: Building2,
                color: 'text-cyan-400',
                bgColor: 'bg-cyan-500/10',
                borderColor: 'border-cyan-400/30',
                sortAt: c.created_at,
            });
        }
    } catch (error) {
        console.warn('[fetchAdminManagerialNotifications] companies:', error);
    }

    try {
        const history = await restGet<PlanHistoryRow[]>(
            [
                'company_billing_plan_history?select=id,company_id,from_plan,to_plan,change_type,created_at,companies(corporate_name,trade_name)',
                `created_at=gte.${encodeURIComponent(sinceIso)}`,
                'change_type=neq.initial',
                'order=created_at.desc',
                'limit=30',
            ].join('&'),
            10_000,
        );

        for (const row of history ?? []) {
            const co = unwrapCompany(row.companies);
            const name = companyDisplayName(co.trade_name, co.corporate_name);
            const fromLabel = row.from_plan
                ? getBillingPlanLabel(row.from_plan as BillingPlanCode)
                : '—';
            const toLabel = getBillingPlanLabel(row.to_plan as BillingPlanCode) || row.to_plan;
            items.push({
                id: `plan_change:${row.id}`,
                type: 'plan_change',
                title: 'Mudança de plano',
                message: `${name}: ${fromLabel} → ${toLabel} (${changeTypeLabel(row.change_type)}).`,
                link: '/admin/settings/companies-billing',
                icon: ArrowLeftRight,
                color: 'text-yellow-400',
                bgColor: 'bg-yellow-500/10',
                borderColor: 'border-yellow-500/30',
                sortAt: row.created_at,
            });
        }
    } catch (error) {
        console.warn('[fetchAdminManagerialNotifications] plan history:', error);
    }

    items.sort((a, b) => new Date(b.sortAt).getTime() - new Date(a.sortAt).getTime());
    return items.map(({ sortAt: _sortAt, ...rest }) => rest);
}

export function useAdminManagerialNotifications(enabled: boolean) {
    const query = useQuery({
        queryKey: ['adminManagerialNotifications'],
        queryFn: fetchAdminManagerialNotifications,
        enabled,
        staleTime: 60_000,
        refetchInterval: 120_000,
        retry: 1,
    });

    return {
        notifications: query.data ?? [],
        isLoading: query.isLoading,
        isError: query.isError,
        hasPending: (query.data?.length ?? 0) > 0,
    };
}

import { useQuery } from '@tanstack/react-query';
import { callRpcRest } from '@/utils/supabase-rest-rpc';

export interface EventTicketInventoryRow {
    event_id: string;
    event_title: string;
    event_date: string | null;
    is_active: boolean;
    is_draft: boolean;
    is_paid: boolean;
    tickets_created: number;
    tickets_sold: number;
    tickets_available: number;
}

export interface CompanyTicketInventoryReport {
    company_id: string;
    company_name: string;
    corporate_name: string | null;
    billing_plan: string | null;
    events: EventTicketInventoryRow[];
    totals: {
        tickets_created: number;
        tickets_sold: number;
        tickets_available: number;
    };
}

async function fetchCompaniesTicketInventory(
    companyId?: string | null,
): Promise<CompanyTicketInventoryReport[]> {
    const row = await callRpcRest<{ companies?: CompanyTicketInventoryReport[] }>(
        'admin_get_companies_event_ticket_inventory',
        { p_company_id: companyId ?? null },
        20_000,
    );

    const companies = Array.isArray(row.companies) ? row.companies : [];
    return companies.map((c) => ({
        ...c,
        events: Array.isArray(c.events) ? c.events : [],
        totals: c.totals ?? { tickets_created: 0, tickets_sold: 0, tickets_available: 0 },
    }));
}

export function useAdminCompaniesTicketInventoryReport(companyId?: string | null) {
    return useQuery({
        queryKey: ['adminCompaniesTicketInventory', companyId ?? 'all'],
        queryFn: () => fetchCompaniesTicketInventory(companyId),
        staleTime: 30_000,
    });
}

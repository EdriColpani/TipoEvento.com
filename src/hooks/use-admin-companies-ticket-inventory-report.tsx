import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

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
    const { data, error } = await supabase.rpc('admin_get_companies_event_ticket_inventory', {
        p_company_id: companyId ?? null,
    });
    if (error) throw new Error(error.message);

    const row = (data ?? {}) as { companies?: CompanyTicketInventoryReport[] };
    const companies = Array.isArray(row.companies) ? row.companies : [];
    return companies.map((c) => ({
        ...c,
        events: Array.isArray(c.events) ? c.events : [],
        totals: c.totals ?? { tickets_created: 0, tickets_sold: 0, tickets_available: 0 },
    }));
}

export function useAdminCompaniesTicketInventoryReport(
    companyId: string | null | undefined,
    enabled: boolean,
) {
    return useQuery({
        queryKey: ['adminCompaniesTicketInventory', companyId ?? 'all'],
        queryFn: () => fetchCompaniesTicketInventory(companyId),
        enabled,
        staleTime: 60_000,
    });
}

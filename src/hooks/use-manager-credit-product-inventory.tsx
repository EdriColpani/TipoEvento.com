import { useQuery } from '@tanstack/react-query';
import { callRpcRest } from '@/utils/supabase-rest-rpc';

export type ManagerCreditProductInventoryRow = {
    product_id: string;
    name: string;
    active: boolean;
    packaging_type: string | null;
    units_per_box: number | null;
    unit_price: number;
    establishment_id: string;
    establishment_name: string;
    stock_quantity: number;
    stock_total_units: number;
    sold_quantity: number;
    sold_revenue: number;
    sold_orders: number;
};

export type ManagerCreditProductInventoryReport = {
    ok: boolean;
    company_id: string;
    establishment_id: string | null;
    items: ManagerCreditProductInventoryRow[];
    totals: {
        products: number;
        stock_quantity: number;
        sold_quantity: number;
        sold_revenue: number;
    };
};

export async function fetchManagerCreditProductInventoryReport(
    companyId: string,
    establishmentId?: string | null,
): Promise<ManagerCreditProductInventoryReport> {
    const data = await callRpcRest<ManagerCreditProductInventoryReport>(
        'list_manager_credit_product_inventory_report',
        {
            p_company_id: companyId,
            p_establishment_id: establishmentId || null,
        },
        15_000,
    );
    return {
        ok: data?.ok === true,
        company_id: data?.company_id ?? companyId,
        establishment_id: data?.establishment_id ?? null,
        items: data?.items ?? [],
        totals: {
            products: Number(data?.totals?.products ?? 0),
            stock_quantity: Number(data?.totals?.stock_quantity ?? 0),
            sold_quantity: Number(data?.totals?.sold_quantity ?? 0),
            sold_revenue: Number(data?.totals?.sold_revenue ?? 0),
        },
    };
}

export function useManagerCreditProductInventoryReport(
    companyId: string | undefined,
    establishmentId?: string | null,
) {
    return useQuery({
        queryKey: ['managerCreditProductInventory', companyId, establishmentId ?? 'all'],
        queryFn: () => fetchManagerCreditProductInventoryReport(companyId!, establishmentId),
        enabled: !!companyId,
        staleTime: 30_000,
    });
}

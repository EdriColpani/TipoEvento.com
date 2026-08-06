import { useQuery, useQueryClient } from '@tanstack/react-query';
import { restGet } from '@/utils/supabase-rest';

export type ConsumptionLicenseChargeStatus = 'pending' | 'paid' | 'cancelled';

export interface ConsumptionLicenseChargeRow {
    id: string;
    company_id: string;
    reference_month: string;
    amount: number;
    status: ConsumptionLicenseChargeStatus;
    notes: string | null;
    paid_at: string | null;
    created_at: string;
    updated_at: string;
    company_name?: string;
    company_cnpj?: string | null;
}

interface ChargeRawRow {
    id: string;
    company_id: string;
    reference_month: string;
    amount: number | string;
    status: string;
    notes: string | null;
    paid_at: string | null;
    created_at: string;
    updated_at: string;
    companies?:
        | { corporate_name: string | null; trade_name: string | null; cnpj: string | null }
        | Array<{ corporate_name: string | null; trade_name: string | null; cnpj: string | null }>
        | null;
}

async function fetchConsumptionLicenseCharges(
    companyId?: string,
): Promise<ConsumptionLicenseChargeRow[]> {
    const select =
        'select=id,company_id,reference_month,amount,status,notes,paid_at,created_at,updated_at,companies(corporate_name,trade_name,cnpj)';
    const filter = companyId ? `&company_id=eq.${companyId}` : '';

    const data = await restGet<ChargeRawRow[]>(
        `company_consumption_license_charges?${select}${filter}&order=reference_month.desc`,
        15_000,
    );

    return (data ?? []).map((row) => {
        const companies = Array.isArray(row.companies) ? row.companies[0] : row.companies;
        return {
            id: row.id,
            company_id: row.company_id,
            reference_month: row.reference_month,
            amount: Number(row.amount),
            status: row.status as ConsumptionLicenseChargeStatus,
            notes: row.notes,
            paid_at: row.paid_at,
            created_at: row.created_at,
            updated_at: row.updated_at,
            company_name: companies?.trade_name || companies?.corporate_name || undefined,
            company_cnpj: companies?.cnpj ?? null,
        };
    });
}

export function useConsumptionLicenseCharges(enabled: boolean, companyId?: string) {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['consumptionLicenseCharges', companyId ?? 'all'],
        queryFn: () => fetchConsumptionLicenseCharges(companyId),
        enabled,
        staleTime: 1000 * 60,
        retry: 1,
    });

    return {
        charges: query.data ?? [],
        isLoading: query.isLoading,
        isError: query.isError,
        error: query.error,
        invalidate: () =>
            queryClient.invalidateQueries({ queryKey: ['consumptionLicenseCharges'] }),
    };
}

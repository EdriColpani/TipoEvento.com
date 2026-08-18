import { useQuery } from '@tanstack/react-query';
import { callRpcRest } from '@/utils/supabase-rest-rpc';

export const TAX_GUIDE_TYPES = [
    'DAS',
    'PIS',
    'COFINS',
    'ISS',
    'IRPJ',
    'CSLL',
    'INSS',
    'DARF',
    'OUTRO',
] as const;

export type TaxGuideType = (typeof TAX_GUIDE_TYPES)[number];
export type TaxGuideStatus = 'open' | 'paid' | 'cancelled';

export type AdminTaxGuideRow = {
    id: string;
    tax_type: TaxGuideType | string;
    description: string;
    competence: string;
    due_date: string;
    amount: number;
    status: TaxGuideStatus | string;
    profit_base_snapshot: number;
    paid_at: string | null;
    cancel_reason: string | null;
    created_at: string;
};

export type AdminTaxGuidesPayload = {
    competence?: string | null;
    profit_base?: number;
    items?: AdminTaxGuideRow[];
    summary?: {
        open_total?: number;
        paid_total?: number;
        cancelled_total?: number;
        guides_count?: number;
    };
};

export function useAdminTaxGuides(competence: string) {
    return useQuery({
        queryKey: ['adminTaxGuides', competence],
        queryFn: () =>
            callRpcRest<AdminTaxGuidesPayload>('list_admin_tax_guides', {
                p_competence: competence || null,
            }, 25_000),
        staleTime: 15_000,
        enabled: Boolean(competence),
    });
}

export async function createAdminTaxGuide(params: {
    taxType: string;
    description: string;
    competence: string;
    dueDate: string;
    amount: number;
}) {
    return callRpcRest<{ ok?: boolean; id?: string; profit_base_snapshot?: number }>(
        'create_admin_tax_guide',
        {
            p_tax_type: params.taxType,
            p_description: params.description,
            p_competence: params.competence,
            p_due_date: params.dueDate,
            p_amount: params.amount,
        },
        20_000,
    );
}

export async function markAdminTaxGuidePaid(id: string, paidAt: string) {
    return callRpcRest<{ ok?: boolean; id?: string; status?: string }>(
        'mark_admin_tax_guide_paid',
        { p_id: id, p_paid_at: paidAt },
        15_000,
    );
}

export async function cancelAdminTaxGuide(id: string, reason: string) {
    return callRpcRest<{ ok?: boolean; id?: string; status?: string }>(
        'cancel_admin_tax_guide',
        { p_id: id, p_reason: reason },
        15_000,
    );
}

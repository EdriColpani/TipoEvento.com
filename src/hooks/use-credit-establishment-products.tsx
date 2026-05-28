import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type CreditEstablishmentProduct = {
    id: string;
    establishment_id: string;
    company_id: string;
    name: string;
    description: string | null;
    unit_price: number;
    active: boolean;
    created_at: string;
    updated_at: string;
};

type ProductsPayload = {
    company_id: string;
    establishment_id: string;
    module_enabled: boolean;
    company_allows_credit: boolean;
    items: CreditEstablishmentProduct[];
};

async function fetchEstablishmentProducts(
    companyId: string,
    establishmentId: string,
): Promise<ProductsPayload> {
    const { data, error } = await supabase.rpc('list_credit_establishment_products', {
        p_company_id: companyId,
        p_establishment_id: establishmentId,
    });
    if (error) throw error;
    const payload = (data ?? {}) as ProductsPayload;
    return {
        ...payload,
        items: payload?.items ?? [],
    };
}

export function useCreditEstablishmentProducts(
    companyId: string | undefined,
    establishmentId: string | undefined,
) {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['creditEstablishmentProducts', companyId, establishmentId],
        queryFn: () => fetchEstablishmentProducts(companyId!, establishmentId!),
        enabled: !!companyId && !!establishmentId,
        staleTime: 30_000,
    });

    const invalidate = () => {
        queryClient.invalidateQueries({
            queryKey: ['creditEstablishmentProducts', companyId, establishmentId],
        });
    };

    return { ...query, invalidate };
}

export async function saveCreditEstablishmentProduct(input: {
    companyId: string;
    establishmentId: string;
    name: string;
    unitPrice: number;
    description?: string | null;
    productId?: string | null;
    active?: boolean;
}) {
    const { data, error } = await supabase.rpc('save_credit_establishment_product', {
        p_company_id: input.companyId,
        p_establishment_id: input.establishmentId,
        p_name: input.name,
        p_unit_price: input.unitPrice,
        p_description: input.description ?? null,
        p_product_id: input.productId ?? null,
        p_active: input.active ?? true,
    });
    if (error) throw error;
    return data as { ok: boolean; product_id: string };
}

export async function setCreditEstablishmentProductActive(input: {
    companyId: string;
    establishmentId: string;
    productId: string;
    active: boolean;
}) {
    const { data, error } = await supabase.rpc('set_credit_establishment_product_active', {
        p_company_id: input.companyId,
        p_establishment_id: input.establishmentId,
        p_product_id: input.productId,
        p_active: input.active,
    });
    if (error) throw error;
    return data as { ok: boolean; active: boolean };
}

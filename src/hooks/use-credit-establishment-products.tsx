import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { callRpcRest } from '@/utils/supabase-rest-rpc';
import { withTimeout } from '@/utils/promise-timeout';

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
    const fallback: ProductsPayload = {
        company_id: companyId,
        establishment_id: establishmentId,
        module_enabled: false,
        company_allows_credit: false,
        items: [],
    };

    try {
        const data = await callRpcRest<ProductsPayload>(
            'list_credit_establishment_products',
            { p_company_id: companyId, p_establishment_id: establishmentId },
            10_000,
        );
        return { ...fallback, ...data, items: data?.items ?? [] };
    } catch (restError) {
        console.warn('[useCreditEstablishmentProducts] REST falhou:', restError);
    }

    const { data, error } = await withTimeout(
        supabase.rpc('list_credit_establishment_products', {
            p_company_id: companyId,
            p_establishment_id: establishmentId,
        }),
        10_000,
        { data: null, error: { message: 'timeout' } as { message: string } },
    );

    if (error?.message && error.message !== 'timeout') throw error;
    const payload = (data ?? {}) as ProductsPayload;
    return { ...fallback, ...payload, items: payload?.items ?? [] };
}

export function useCreditEstablishmentProducts(
    companyId: string | undefined,
    establishmentId: string | undefined,
) {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['creditEstablishmentProducts', companyId, establishmentId],
        queryFn: () => withTimeout(fetchEstablishmentProducts(companyId!, establishmentId!), 12_000, {
            company_id: companyId!,
            establishment_id: establishmentId!,
            module_enabled: false,
            company_allows_credit: false,
            items: [],
        }),
        enabled: !!companyId && !!establishmentId,
        staleTime: 30_000,
        retry: 1,
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
    const args = {
        p_company_id: input.companyId,
        p_establishment_id: input.establishmentId,
        p_name: input.name,
        p_unit_price: input.unitPrice,
        p_description: input.description ?? null,
        p_product_id: input.productId ?? null,
        p_active: input.active ?? true,
    };

    try {
        return await callRpcRest<{ ok: boolean; product_id: string }>(
            'save_credit_establishment_product',
            args,
            15_000,
        );
    } catch (restError) {
        console.warn('[saveCreditEstablishmentProduct] REST falhou:', restError);
    }

    const { data, error } = await withTimeout(
        supabase.rpc('save_credit_establishment_product', args),
        15_000,
        { data: null, error: { message: 'Tempo esgotado ao salvar produto.' } as { message: string } },
    );
    if (error?.message) throw new Error(error.message);
    return data as { ok: boolean; product_id: string };
}

export async function setCreditEstablishmentProductActive(input: {
    companyId: string;
    establishmentId: string;
    productId: string;
    active: boolean;
}) {
    const args = {
        p_company_id: input.companyId,
        p_establishment_id: input.establishmentId,
        p_product_id: input.productId,
        p_active: input.active,
    };

    try {
        return await callRpcRest<{ ok: boolean; active: boolean }>(
            'set_credit_establishment_product_active',
            args,
            12_000,
        );
    } catch (restError) {
        console.warn('[setCreditEstablishmentProductActive] REST falhou:', restError);
    }

    const { data, error } = await withTimeout(
        supabase.rpc('set_credit_establishment_product_active', args),
        12_000,
        { data: null, error: { message: 'Tempo esgotado.' } as { message: string } },
    );
    if (error?.message) throw new Error(error.message);
    return data as { ok: boolean; active: boolean };
}

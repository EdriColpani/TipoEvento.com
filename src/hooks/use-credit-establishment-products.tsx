import { useQuery, useQueryClient } from '@tanstack/react-query';
import { callRpcRest } from '@/utils/supabase-rest-rpc';
import { withTimeout } from '@/utils/promise-timeout';

export type CreditProductPackagingType = 'unit' | 'box';

export type CreditEstablishmentProduct = {
    id: string;
    establishment_id: string;
    company_id: string;
    name: string;
    description: string | null;
    unit_price: number;
    app_discount_pct?: number;
    app_unit_price?: number;
    active: boolean;
    image_url: string | null;
    packaging_type: CreditProductPackagingType;
    units_per_box: number | null;
    quantity: number;
    total_units?: number;
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

    const data = await callRpcRest<ProductsPayload>(
        'list_credit_establishment_products',
        { p_company_id: companyId, p_establishment_id: establishmentId },
        10_000,
    );
    return {
        ...fallback,
        ...data,
        items: (data?.items ?? []).map((item) => ({
            ...item,
            packaging_type: item.packaging_type === 'box' ? 'box' : 'unit',
            units_per_box: item.units_per_box == null ? null : Number(item.units_per_box),
            quantity: Number(item.quantity ?? 0),
            total_units: Number(
                item.total_units ??
                    (item.packaging_type === 'box'
                        ? Number(item.units_per_box ?? 0) * Number(item.quantity ?? 0)
                        : Number(item.quantity ?? 0)),
            ),
            image_url: item.image_url ?? null,
            app_discount_pct: Number(item.app_discount_pct ?? 0),
            app_unit_price: Number(
                item.app_unit_price ??
                    Number(item.unit_price) *
                        (1 - Number(item.app_discount_pct ?? 0) / 100),
            ),
        })),
    };
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
    imageUrl?: string | null;
    packagingType?: CreditProductPackagingType;
    unitsPerBox?: number | null;
    quantity?: number;
    appDiscountPct?: number;
}) {
    return callRpcRest<{ ok: boolean; product_id: string; total_units: number }>(
        'save_credit_establishment_product',
        {
            p_company_id: input.companyId,
            p_establishment_id: input.establishmentId,
            p_name: input.name,
            p_unit_price: input.unitPrice,
            p_description: input.description ?? null,
            p_product_id: input.productId ?? null,
            p_active: input.active ?? true,
            p_image_url: input.imageUrl ?? null,
            p_packaging_type: input.packagingType ?? 'unit',
            p_units_per_box: input.packagingType === 'box' ? (input.unitsPerBox ?? null) : null,
            p_quantity: input.quantity ?? 0,
            p_app_discount_pct: input.appDiscountPct ?? 0,
        },
        15_000,
    );
}

export async function applyCreditProductAppDiscount(input: {
    companyId: string;
    establishmentId: string;
    appDiscountPct: number;
    scope: 'establishment' | 'event';
}) {
    return callRpcRest<{ ok: boolean; updated_count: number; app_discount_pct: number; scope: string }>(
        'apply_credit_product_app_discount',
        {
            p_company_id: input.companyId,
            p_establishment_id: input.establishmentId,
            p_app_discount_pct: input.appDiscountPct,
            p_scope: input.scope,
        },
        15_000,
    );
}

export async function setCreditEstablishmentProductActive(input: {
    companyId: string;
    establishmentId: string;
    productId: string;
    active: boolean;
}) {
    return callRpcRest<{ ok: boolean; active: boolean }>(
        'set_credit_establishment_product_active',
        {
            p_company_id: input.companyId,
            p_establishment_id: input.establishmentId,
            p_product_id: input.productId,
            p_active: input.active,
        },
        12_000,
    );
}

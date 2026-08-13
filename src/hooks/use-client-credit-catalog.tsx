import { useQuery } from '@tanstack/react-query';
import { callRpcRest } from '@/utils/supabase-rest-rpc';

export type ClientCreditCatalogProduct = {
    id: string;
    name: string;
    description: string | null;
    unit_price: number;
    app_discount_pct?: number;
    app_unit_price?: number;
    image_url: string | null;
    packaging_type: 'unit' | 'box' | string | null;
    units_per_box: number | null;
    stock_quantity: number;
    total_units: number;
};

export type ClientCreditCatalogEstablishment = {
    establishment_id: string;
    name: string;
    address: string | null;
    event_id: string | null;
    products: ClientCreditCatalogProduct[];
};

export type ClientEventCreditCatalog = {
    ok: boolean;
    event: {
        id: string;
        title: string;
        date: string | null;
        location: string | null;
        company_id: string;
        company_name: string;
    } | null;
    establishments: ClientCreditCatalogEstablishment[];
    message: string | null;
};

export type ClientEstablishmentCreditCatalog = {
    ok: boolean;
    establishment: {
        id: string;
        name: string;
        address?: string | null;
        company_id: string;
        company_name: string;
        event_id: string | null;
        event_title: string | null;
    } | null;
    products: ClientCreditCatalogProduct[];
    message: string | null;
};

export async function fetchClientEventCreditCatalog(
    eventId: string,
): Promise<ClientEventCreditCatalog> {
    return callRpcRest<ClientEventCreditCatalog>(
        'list_client_event_credit_catalog',
        { p_event_id: eventId },
        15_000,
    );
}

export async function fetchClientEstablishmentCreditCatalog(
    establishmentId: string,
): Promise<ClientEstablishmentCreditCatalog> {
    return callRpcRest<ClientEstablishmentCreditCatalog>(
        'list_client_establishment_credit_catalog',
        { p_establishment_id: establishmentId },
        15_000,
    );
}

export async function fetchClientEventHasCreditCatalog(eventId: string): Promise<boolean> {
    const data = await callRpcRest<boolean>(
        'client_event_has_credit_catalog',
        { p_event_id: eventId },
        10_000,
    );
    return data === true;
}

export function useClientEventCreditCatalog(eventId: string | undefined) {
    return useQuery({
        queryKey: ['clientEventCreditCatalog', eventId],
        queryFn: () => fetchClientEventCreditCatalog(eventId!),
        enabled: !!eventId,
        staleTime: 30_000,
    });
}

export function useClientEstablishmentCreditCatalog(establishmentId: string | undefined) {
    return useQuery({
        queryKey: ['clientEstablishmentCreditCatalog', establishmentId],
        queryFn: () => fetchClientEstablishmentCreditCatalog(establishmentId!),
        enabled: !!establishmentId,
        staleTime: 30_000,
    });
}

export function useClientEventHasCreditCatalog(eventId: string | undefined) {
    return useQuery({
        queryKey: ['clientEventHasCreditCatalog', eventId],
        queryFn: () => fetchClientEventHasCreditCatalog(eventId!),
        enabled: !!eventId,
        staleTime: 60_000,
    });
}

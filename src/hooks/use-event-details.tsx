import { useQuery } from '@tanstack/react-query';
import { showError } from '@/utils/toast';
import { parseHighlightsFromDb } from '@/utils/event-highlights';
import { restGetAuthOrPublic } from '@/utils/supabase-rest';
import { callRpcAuthOrPublicRest } from '@/utils/supabase-rest-rpc';

// Estrutura de dados do Evento (simplificada)
export interface EventData {
    id: string;
    title: string;
    description: string;
    highlights: string[];
    date: string;
    time: string;
    location: string;
    address: string;
    address_lat: number | null;
    address_lng: number | null;
    address_place_id: string | null;
    image_url: string; // Imagem do Card Principal (770x450)
    exposure_card_image_url: string | null; // NOVO: Imagem do Card de Exposição (400x200)
    banner_image_url: string | null; // Banner da tela do evento (900x500)
    min_age: number;
    category: string;
    capacity: number; // Adicionando capacidade
    duration: string; // Adicionando duração
    min_price: number | null; // NOVO: Preço mínimo calculado
    min_price_wristband_id: string | null; // NOVO: ID da pulseira mais barata
    /** false quando o organizador desativou o evento (sem novas vendas na vitrine). */
    is_active: boolean;
    /** true = apenas divulgação; sem venda de ingressos pela plataforma. */
    listing_only: boolean;
    /** Aceita pagamento com crédito EventFest (rede). */
    credit_consumption_enabled: boolean;

    // Dados do Organizador (JOIN)
    companies: {
        corporate_name: string;
    } | null;
}

// Estrutura de dados do Tipo de Ingresso (baseado em pulseiras)
export interface TicketType {
    id: string; // ID da pulseira (wristband_id)
    name: string; // Nome do tipo de acesso (access_type)
    price: number;
    available: number; // Simulação de disponibilidade (contagem de pulseiras ativas)
    description: string; // Descrição do tipo de acesso
    /** Lote dentro da janela de vendas (modo counter). */
    salesOpen?: boolean;
    batchStartDate?: string | null;
    batchEndDate?: string | null;
}

// Estrutura de dados agrupada para a tela de detalhes
export interface EventDetailsData {
    event: EventData;
    ticketTypes: TicketType[];
}

const EVENT_SELECT_WITH_HIGHLIGHTS =
    'id,title,description,highlights,date,time,location,address,address_lat,address_lng,address_place_id,image_url,exposure_card_image_url,banner_image_url,min_age,category,capacity,duration,company_id,is_active,listing_only,is_paid,credit_consumption_enabled';

const EVENT_SELECT_LEGACY =
    'id,title,description,date,time,location,address,address_lat,address_lng,address_place_id,image_url,exposure_card_image_url,banner_image_url,min_age,category,capacity,duration,company_id,is_active,listing_only,is_paid,credit_consumption_enabled';

async function fetchEventRow(eventId: string): Promise<Record<string, unknown> | null> {
    try {
        const rows = await restGetAuthOrPublic<Record<string, unknown>[]>(
            `events?id=eq.${encodeURIComponent(eventId)}&select=${EVENT_SELECT_WITH_HIGHLIGHTS}&limit=1`,
            12_000,
        );
        return rows?.[0] ?? null;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.toLowerCase().includes('highlights')) {
            console.error('[useEventDetails] events REST:', error);
            return null;
        }
    }

    try {
        const rows = await restGetAuthOrPublic<Record<string, unknown>[]>(
            `events?id=eq.${encodeURIComponent(eventId)}&select=${EVENT_SELECT_LEGACY}&limit=1`,
            12_000,
        );
        return rows?.[0] ?? null;
    } catch (error) {
        console.error('[useEventDetails] events REST fallback:', error);
        return null;
    }
}

const fetchEventDetails = async (eventId: string): Promise<EventDetailsData | null> => {
    if (!eventId) return null;

    const eventDataRaw = await fetchEventRow(eventId);
    if (!eventDataRaw) {
        console.warn(`Event not found: ${eventId}`);
        return null;
    }

    let corporateName: string | null = null;
    const companyId = eventDataRaw.company_id ? String(eventDataRaw.company_id) : null;
    if (companyId) {
        try {
            const companies = await restGetAuthOrPublic<{ corporate_name?: string }[]>(
                `companies?id=eq.${encodeURIComponent(companyId)}&select=corporate_name&limit=1`,
                8_000,
            );
            corporateName = companies?.[0]?.corporate_name ?? null;
        } catch (error) {
            console.warn('[useEventDetails] company REST:', error);
        }
    }

    let ticketTypes: TicketType[] = [];

    try {
        const availability = await callRpcAuthOrPublicRest<{
            ok?: boolean;
            ticket_types?: Array<{
                id?: string;
                wristband_id?: string;
                name?: string;
                price?: number;
                available?: number;
                sales_open?: boolean;
                batch_active?: boolean;
                start_date?: string | null;
                end_date?: string | null;
            }>;
        }>('get_event_ticket_availability', { p_event_id: eventId }, 12_000);

        if (availability?.ok && Array.isArray(availability.ticket_types)) {
            ticketTypes = availability.ticket_types
                .map((t) => ({
                    id: String(t.wristband_id ?? t.id ?? ''),
                    name: String(t.name ?? 'Ingresso'),
                    price: Number(t.price ?? 0),
                    available: Number(t.available ?? 0),
                    description: `Acesso ${t.name ?? 'ingresso'} para o evento.`,
                    salesOpen: t.sales_open === true && t.batch_active === true,
                    batchStartDate: t.start_date ?? null,
                    batchEndDate: t.end_date ?? null,
                }))
                .filter((t) => t.id && t.price > 0 && t.available > 0 && t.salesOpen === true)
                .sort((a, b) => a.price - b.price);
        }
    } catch (error) {
        console.error('[useEventDetails] get_event_ticket_availability:', error);
    }

    let minPrice: number | null = null;
    let minPriceWristbandId: string | null = null;

    const purchasableTicketTypes = ticketTypes.filter((t) => t.salesOpen === true);

    if (purchasableTicketTypes.length > 0) {
        const cheapest = purchasableTicketTypes.reduce(
            (min, t) => (min === null || t.price < min.price ? t : min),
            null as TicketType | null,
        );
        minPrice = cheapest ? cheapest.price : null;
        minPriceWristbandId = cheapest ? cheapest.id : null;
    }

    const highlights = parseHighlightsFromDb(
        (eventDataRaw as { highlights?: unknown }).highlights,
    );

    const event: EventData = {
        ...eventDataRaw,
        highlights,
        min_price: minPrice,
        min_price_wristband_id: minPriceWristbandId,
        is_active: (eventDataRaw as { is_active?: boolean }).is_active !== false,
        listing_only: (eventDataRaw as { listing_only?: boolean }).listing_only === true,
        credit_consumption_enabled:
            (eventDataRaw as { credit_consumption_enabled?: boolean }).credit_consumption_enabled === true,
        exposure_card_image_url: (eventDataRaw.exposure_card_image_url as string) || null,
        banner_image_url: (eventDataRaw.banner_image_url as string) || null,
        companies: corporateName ? { corporate_name: corporateName } : null,
    } as EventData;

    return {
        event,
        ticketTypes: event.listing_only ? [] : ticketTypes,
    };
};

export const useEventDetails = (eventId: string | undefined) => {
    const query = useQuery({
        queryKey: ['eventDetails', eventId],
        queryFn: () => fetchEventDetails(eventId!),
        enabled: !!eventId,
        staleTime: 1000 * 60 * 5,
        retry: 1,
        onError: (error) => {
            console.error('Query Error: Failed to load event details.', error);
            showError('Erro ao carregar detalhes do evento. Tente recarregar.');
        },
    });

    return {
        details: query.data ?? null,
        isLoading: query.isLoading,
        isError: query.isError || (!query.isLoading && query.data === null && !!eventId),
        refetch: query.refetch,
    };
};

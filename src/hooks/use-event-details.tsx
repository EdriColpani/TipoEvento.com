import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { showError } from '@/utils/toast';
import { parseHighlightsFromDb } from '@/utils/event-highlights';

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

const fetchEventDetails = async (eventId: string): Promise<EventDetailsData | null> => {
    if (!eventId) return null;

    // 1. Buscar detalhes do Evento (sem o JOIN de companies primeiro para evitar erro PGRST201)
    // Vamos buscar a empresa separadamente se necessário
    const eventSelectWithHighlights = `
            id, title, description, highlights, date, time, location, address, address_lat, address_lng, address_place_id, image_url, exposure_card_image_url, banner_image_url, min_age, category, capacity, duration, company_id, is_active, listing_only, is_paid, credit_consumption_enabled
        `;
    const eventSelectLegacy = `
            id, title, description, date, time, location, address, address_lat, address_lng, address_place_id, image_url, exposure_card_image_url, banner_image_url, min_age, category, capacity, duration, company_id, is_active, listing_only, is_paid, credit_consumption_enabled
        `;

    let eventDataRaw: Record<string, unknown> | null = null;
    let eventError: { code?: string; message?: string; details?: string; hint?: string } | null = null;

    const primary = await supabase
        .from('events')
        .select(eventSelectWithHighlights)
        .eq('id', eventId)
        .maybeSingle();

    eventDataRaw = primary.data as Record<string, unknown> | null;
    eventError = primary.error;

    if (eventError?.message?.includes('highlights')) {
        const fallback = await supabase
            .from('events')
            .select(eventSelectLegacy)
            .eq('id', eventId)
            .maybeSingle();
        eventDataRaw = fallback.data as Record<string, unknown> | null;
        eventError = fallback.error;
    }

    if (eventError) {
        if (eventError.code === 'PGRST116') { // No rows found
            console.warn(`Event not found: ${eventId}`);
            return null;
        }
        console.error("Error fetching event details:", {
            code: eventError.code,
            message: eventError.message,
            details: eventError.details,
            hint: eventError.hint,
            eventId
        });
        // Retorna null em vez de lançar erro para mostrar página 404 amigável
        return null;
    }
    
    if (!eventDataRaw) {
        console.warn(`Event data is null for ID: ${eventId}`);
        return null;
    }

    // 2. Buscar dados da empresa separadamente usando o company_id
    let corporateName: string | null = null;
    if (eventDataRaw.company_id) {
        const { data: companyData, error: companyError } = await supabase
            .from('companies')
            .select('corporate_name')
            .eq('id', eventDataRaw.company_id)
            .maybeSingle();

        if (!companyError && companyData) {
            corporateName = companyData.corporate_name;
        }
    }
    
    // 3. Disponibilidade via RPC (suporta unit_rows e counter)
    const { data: availabilityPayload, error: availabilityError } = await supabase.rpc(
        'get_event_ticket_availability',
        { p_event_id: eventId },
    );

    if (availabilityError) {
        console.error('[useEventDetails] get_event_ticket_availability:', availabilityError);
    }

    const availability = availabilityPayload as {
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
    } | null;

    let ticketTypes: TicketType[] = [];

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
    } else {
        // Fallback legado
        const { data: wristbandsData, error: wristbandsError } = await supabase
            .from('wristbands')
            .select('id, access_type, price, status')
            .eq('event_id', eventId);

        if (wristbandsError) {
            console.error('Error fetching wristbands for event:', wristbandsError);
        }

        const wristbands = wristbandsData || [];
        const activeWristbands = wristbands.filter((w: { status?: string }) => w.status === 'active');
        const availabilityByWristbandId: Record<string, number> = {};

        await Promise.all(
            activeWristbands.map(async (w: { id: string }) => {
                const { count, error } = await supabase
                    .from('wristband_analytics')
                    .select('id', { count: 'exact', head: true })
                    .eq('wristband_id', w.id)
                    .eq('status', 'active')
                    .is('client_user_id', null);

                availabilityByWristbandId[w.id] = error ? 0 : (count ?? 0);
            }),
        );

        ticketTypes = activeWristbands
            .map((w: { id: string; access_type: string; price: unknown }) => {
                const price = parseFloat(String(w.price ?? '')) || 0;
                const available = availabilityByWristbandId[w.id] ?? 0;
                return {
                    id: w.id,
                    name: w.access_type,
                    price,
                    available,
                    description: `Acesso ${w.access_type} para o evento.`,
                } as TicketType;
            })
            .filter((t) => t.available > 0)
            .sort((a, b) => a.price - b.price);
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
    
    // 5. Combinar dados
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
        exposure_card_image_url: eventDataRaw.exposure_card_image_url || null, // Mapeando o novo campo
        banner_image_url: eventDataRaw.banner_image_url || null,
        companies: corporateName ? { corporate_name: corporateName } : null,
    } as EventData;


    return {
        event: event,
        ticketTypes: event.listing_only ? [] : ticketTypes,
    };
};

export const useEventDetails = (eventId: string | undefined) => {
    const query = useQuery({
        queryKey: ['eventDetails', eventId],
        queryFn: () => fetchEventDetails(eventId!),
        enabled: !!eventId,
        staleTime: 1000 * 60 * 5, // 5 minutes
        onError: (error) => {
            console.error("Query Error: Failed to load event details.", error);
            showError("Erro ao carregar detalhes do evento. Tente recarregar.");
        }
    });

    return {
        ...query,
        details: query.data,
    };
};
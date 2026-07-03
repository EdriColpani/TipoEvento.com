import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { formatEventDateForDisplay, parseEventLocalDay } from '@/utils/format-event-date';
import { isEventOpenForNewSales } from '@/utils/event-sales-window';
import { pickMinimumPaidPrice } from '@/utils/public-event-pricing';

export interface PublicEvent {
    id: string;
    title: string;
    description: string;
    date: string; // dd/MM/yyyy para exibição
    raw_date: Date | null; // Dia do evento no calendário local (filtros “hoje”, etc.)
    time: string;
    location: string;
    image_url: string; // RENOMEADO: Agora é a URL da imagem do Card de Exposição (400x200)
    category: string;
    is_paid: boolean; // Evento pago ou gratuito
    listing_only: boolean; // Vitrine — sem venda de ingressos
    min_price: number | null; // Preço mínimo calculado
    min_price_wristband_id: string | null;
    total_available_tickets: number; // New: total count of active wristbands for the event
    capacity: number; // New: event capacity from the 'events' table
}

type EventAggregate = {
    min_price: number;
    min_price_wristband_id: string | null;
    total_available_tickets: number;
};

function parsePrice(raw: unknown): number {
    if (typeof raw === 'number') return raw;
    return parseFloat(String(raw ?? '').replace(',', '.')) || 0;
}

async function fillMinPriceFromAvailabilityRpc(
    eventId: string,
    aggregate: EventAggregate,
): Promise<void> {
    const { data, error } = await supabase.rpc('get_event_ticket_availability', {
        p_event_id: eventId,
    });
    if (error) {
        console.error('[usePublicEvents] get_event_ticket_availability:', eventId, error);
        return;
    }

    const payload = data as {
        ok?: boolean;
        ticket_types?: Array<{ price?: number; wristband_id?: string; id?: string }>;
    } | null;

    if (!payload?.ok || !Array.isArray(payload.ticket_types)) return;

    for (const ticket of payload.ticket_types) {
        const price = parsePrice(ticket.price);
        if (price > 0 && price < aggregate.min_price) {
            aggregate.min_price = price;
            aggregate.min_price_wristband_id = String(ticket.wristband_id ?? ticket.id ?? '') || null;
        }
    }
}

const fetchPublicEvents = async (): Promise<PublicEvent[]> => {
    try {
        const { data: eventsData, error: eventsError } = await supabase.rpc('get_public_vitrine_events');

        if (eventsError) {
            console.error('[usePublicEvents] get_public_vitrine_events:', eventsError.message);
            throw eventsError;
        }

        if (!eventsData?.length) {
            return [];
        }

        const openForSales = eventsData.filter((e) =>
            isEventOpenForNewSales(e.date, e.event_time ?? e.time),
        );
    const eventIds = openForSales.map((e) => e.id);

    const eventAggregates: Record<string, EventAggregate> = {};
    eventIds.forEach((id) => {
        eventAggregates[id] = { min_price: Infinity, min_price_wristband_id: null, total_available_tickets: 0 };
    });

    const listingOnlyIds = new Set(
        openForSales.filter((e) => e.listing_only === true).map((e) => e.id),
    );

    const ticketSalesEventIds = eventIds.filter((id) => !listingOnlyIds.has(id));
    const counterEventIds = new Set(
        openForSales
            .filter((e) => e.inventory_mode === 'counter' && !listingOnlyIds.has(e.id))
            .map((e) => e.id),
    );

    if (ticketSalesEventIds.length > 0) {
        // Preços dos lotes (ignora Staff/gratuitos com price = 0)
        const { data: batchesData, error: batchesError } = await supabase
            .from('event_batches')
            .select('event_id, price')
            .in('event_id', ticketSalesEventIds)
            .gt('price', 0);

        if (batchesError) {
            console.error('Error fetching event batches for public catalog:', batchesError);
        }

        batchesData?.forEach((row) => {
            const price = parsePrice(row.price);
            const aggregate = eventAggregates[row.event_id];
            if (!aggregate || price <= 0) return;
            if (price < aggregate.min_price) {
                aggregate.min_price = price;
            }
        });

        // Estoque counter (batch_inventory)
        if (counterEventIds.size > 0) {
            const { data: inventoryData, error: inventoryError } = await supabase
                .from('batch_inventory')
                .select('event_id, total, sold, reserved')
                .in('event_id', [...counterEventIds]);

            if (inventoryError) {
                console.error('Error fetching batch_inventory for public catalog:', inventoryError);
            }

            inventoryData?.forEach((row) => {
                const aggregate = eventAggregates[row.event_id];
                if (!aggregate) return;
                const available = Math.max(
                    0,
                    Number(row.total ?? 0) - Number(row.sold ?? 0) - Number(row.reserved ?? 0),
                );
                aggregate.total_available_tickets += available;
            });
        }

        const unitRowsEventIds = ticketSalesEventIds.filter((id) => !counterEventIds.has(id));

        if (unitRowsEventIds.length > 0) {
            const { data: wristbandsData, error: wristbandsError } = await supabase
                .from('wristbands')
                .select('event_id, id, price, status')
                .in('event_id', unitRowsEventIds);

            if (wristbandsError) {
                console.error('Error fetching wristband data:', wristbandsError);
            }

            wristbandsData?.forEach((item) => {
                const aggregate = eventAggregates[item.event_id];
                if (!aggregate) return;
                const price = parsePrice(item.price);
                if (price > 0 && price < aggregate.min_price) {
                    aggregate.min_price = price;
                    aggregate.min_price_wristband_id = item.id;
                }
                if (item.status === 'active') {
                    aggregate.total_available_tickets += 1;
                }
            });
        }

        // Fallback RPC para eventos pagos sem preço (ex.: counter com ticket_price 0 no evento)
        const rpcFallbackIds = openForSales
            .filter(
                (e) =>
                    e.is_paid &&
                    !e.listing_only &&
                    eventAggregates[e.id]?.min_price === Infinity,
            )
            .map((e) => e.id)
            .slice(0, 8);

        await Promise.all(
            rpcFallbackIds.map(async (eventId) => {
                await fillMinPriceFromAvailabilityRpc(eventId, eventAggregates[eventId]);
            }),
        );
    }

    return openForSales.map((event) => {
        const aggregates = eventAggregates[event.id] || {
            min_price: Infinity,
            min_price_wristband_id: null,
            total_available_tickets: 0,
        };

        const minPrice = event.listing_only
            ? null
            : pickMinimumPaidPrice([
                  aggregates.min_price === Infinity ? null : aggregates.min_price,
                  event.ticket_price,
              ]);

        return {
            id: event.id,
            title: event.title,
            description: event.description,
            date: formatEventDateForDisplay(event.date) || String(event.date ?? ''),
            raw_date: parseEventLocalDay(event.date),
            time: event.event_time ?? event.time,
            location: event.location,
            image_url: event.exposure_card_image_url,
            category: event.category,
            is_paid: event.is_paid === true,
            listing_only: event.listing_only === true,
            min_price: minPrice,
            min_price_wristband_id: aggregates.min_price_wristband_id,
            total_available_tickets: aggregates.total_available_tickets,
            capacity: event.capacity,
        };
    });
    } catch (e) {
        console.error('[usePublicEvents] fetch failed', e);
        throw e;
    }
};

export const usePublicEvents = () => {
    const query = useQuery({
        queryKey: ['publicEvents', 'v3-rpc'],
        queryFn: fetchPublicEvents,
        staleTime: 1000 * 60 * 2,
        retry: 2,
        refetchOnWindowFocus: false,
    });

    return {
        ...query,
        events: query.data ?? [],
        isLoading: query.isLoading,
        isError: query.isError,
    };
};

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { showError } from '@/utils/toast';
import { formatEventDateForDisplay, parseEventLocalDay } from '@/utils/format-event-date';
import { isEventOpenForNewSales } from '@/utils/event-sales-window';

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
    min_price: number | null; // Preço mínimo calculado
    min_price_wristband_id: string | null;
    total_available_tickets: number; // New: total count of active wristbands for the event
    capacity: number; // New: event capacity from the 'events' table
}

const fetchPublicEvents = async (): Promise<PublicEvent[]> => {
    // 1. Buscar todos os eventos com capacidade
    const { data: eventsData, error: eventsError } = await supabase
        .from('events')
        .select(`
            id, title, description, date, time, location, exposure_card_image_url, category, capacity, is_paid, ticket_price, is_active
        `)
        .eq('is_active', true)
        .order('date', { ascending: true });

    if (eventsError) {
        console.error("Error fetching public events:", eventsError);
        throw new Error(eventsError.message);
    }

    const openForSales = eventsData.filter((e) => isEventOpenForNewSales(e.date, e.time));
    const eventIds = openForSales.map((e) => e.id);

    // Inicializar agregados para todos os eventos (para contar pulseiras e preço de lotes)
    const eventAggregates: { [eventId: string]: { min_price: number; min_price_wristband_id: string | null; total_available_tickets: number } } = {};
    eventIds.forEach(id => {
        eventAggregates[id] = { min_price: Infinity, min_price_wristband_id: null, total_available_tickets: 0 };
    });

    // 2. Preço mínimo dos LOTES (event_batches) — ingressos com valor por lote
    const { data: batchesData } = await supabase
        .from('event_batches')
        .select('event_id, price')
        .in('event_id', eventIds);

    if (batchesData?.length) {
        batchesData.forEach((row: { event_id: string; price: unknown }) => {
            const price = typeof row.price === 'number' ? row.price : parseFloat(String(row.price ?? '').replace(',', '.')) || 0;
            if (price >= 0 && price < eventAggregates[row.event_id].min_price) {
                eventAggregates[row.event_id].min_price = price;
            }
        });
    }

    // 3. Pulseiras: menor preço entre todas as pulseiras + contagem de disponíveis (active)
    const { data: wristbandsData, error: wristbandsError } = await supabase
        .from('wristbands')
        .select('event_id, id, price, status')
        .in('event_id', eventIds);

    if (wristbandsError) {
        console.error("Error fetching wristband data:", wristbandsError);
    }

    if (wristbandsData?.length) {
        wristbandsData.forEach(item => {
            const price = typeof item.price === 'number' ? item.price : parseFloat(String(item.price ?? '').replace(',', '.')) || 0;
            if (price >= 0 && price < eventAggregates[item.event_id].min_price) {
                eventAggregates[item.event_id].min_price = price;
                eventAggregates[item.event_id].min_price_wristband_id = item.id;
            }
            if (item.status === 'active') {
                eventAggregates[item.event_id].total_available_tickets += 1;
            }
        });
    }

    // 4. Combinar dados e formatar (min_price = menor entre lotes, pulseiras e events.ticket_price)
    return openForSales.map((event) => {
        const aggregates = eventAggregates[event.id] || { min_price: Infinity, min_price_wristband_id: null, total_available_tickets: 0 };
        const fromBatchesOrWristbands = aggregates.min_price;
        const fromEvent = event.ticket_price != null ? Number(event.ticket_price) : Infinity;
        const minPriceValue = Math.min(fromBatchesOrWristbands, fromEvent);
        const minPrice = minPriceValue === Infinity ? null : minPriceValue;

        return {
            id: event.id,
            title: event.title,
            description: event.description,
            date: formatEventDateForDisplay(event.date) || String(event.date ?? ''),
            raw_date: parseEventLocalDay(event.date),
            time: event.time,
            location: event.location,
            image_url: event.exposure_card_image_url, // USANDO O NOVO CAMPO PARA O CARD DE EXPOSIÇÃO
            category: event.category,
            is_paid: event.is_paid === true,
            min_price: minPrice,
            min_price_wristband_id: aggregates.min_price_wristband_id,
            total_available_tickets: aggregates.total_available_tickets,
            capacity: event.capacity,
        };
    });
};

export const usePublicEvents = () => {
    const query = useQuery({
        queryKey: ['publicEvents'],
        queryFn: fetchPublicEvents,
        staleTime: 1000 * 60 * 5, // 5 minutes
        onError: (error) => {
            console.error("Query Error: Failed to load public events.", error);
            showError("Erro ao carregar a lista de eventos.");
        }
    });

    return {
        ...query,
        events: query.data || [],
    };
};
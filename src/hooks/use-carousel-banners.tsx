import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { showError } from '@/utils/toast';
import { useCarouselSettings, CarouselSettings } from './use-carousel-settings'; // Importando as configurações
import { isAfter, isBefore, differenceInDays } from 'date-fns';
import { parseEventLocalDay } from '@/utils/format-event-date';

export interface CarouselBanner {
    id: string;
    title: string;
    subtitle: string;
    image: string;
    link: string | null;
    display_order: number;
    type: 'event' | 'promotional';
    // Campos adicionais para ordenação
    event_date?: Date; 
    is_regional?: boolean;
}

// Função para buscar banners de eventos ativos
const fetchEventBanners = async (): Promise<CarouselBanner[]> => {
    // A política RLS pública já filtra por banners ativos (start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE)
    const { data, error } = await supabase
        .from('event_carousel_banners')
        .select(`
            id,
            image_url,
            headline,
            subheadline,
            display_order,
            event_id,
            events (date)
        `)
        .order('display_order', { ascending: true });

    if (error) {
        console.error("Error fetching event banners:", error);
        throw new Error(error.message);
    }

    return data.map(item => ({
        id: item.id,
        title: item.headline || 'Evento em Destaque',
        subtitle: item.subheadline || '',
        image: item.image_url,
        link: item.event_id ? `/events/${item.event_id}` : null,
        display_order: item.display_order,
        type: 'event' as const,
        event_date: item.events?.date ? parseEventLocalDay(item.events.date) ?? undefined : undefined,
        is_regional: true, // SIMULAÇÃO: Todos são regionais por padrão
    }));
};

// Função para buscar banners promocionais ativos
const fetchPromotionalBanners = async (): Promise<CarouselBanner[]> => {
    // A política RLS pública já filtra por banners ativos (start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE)
    const { data, error } = await supabase
        .from('promotional_banners')
        .select(`
            id,
            image_url,
            headline,
            subheadline,
            display_order,
            link_url
        `)
        .order('display_order', { ascending: true });

    if (error) {
        console.error("Error fetching promotional banners:", error);
        throw new Error(error.message);
    }

    return data.map(item => ({
        id: item.id,
        title: item.headline || 'Promoção',
        subtitle: item.subheadline || '',
        image: item.image_url,
        link: item.link_url,
        display_order: item.display_order,
        type: 'promotional' as const,
    }));
};

// Função principal para combinar, ordenar e limitar
const fetchAndProcessBanners = async (settings: CarouselSettings): Promise<CarouselBanner[]> => {
    const [eventBanners, promotionalBanners] = await Promise.all([
        fetchEventBanners(),
        fetchPromotionalBanners(),
    ]);

    let combinedBanners = [...eventBanners, ...promotionalBanners];
    const today = new Date();

    // 1. Pré-filtragem e marcação de prioridade (Eventos Próximos)
    combinedBanners = combinedBanners.map(banner => {
        if (banner.type === 'event' && banner.event_date) {
            const daysUntil = differenceInDays(banner.event_date, today);
            // Marca se o evento está dentro do threshold de dias
            const isUpcomingPriority = daysUntil >= 0 && daysUntil <= settings.days_until_event_threshold;
            return { ...banner, isUpcomingPriority };
        }
        return banner;
    });

    // 2. Ordenação Complexa
    combinedBanners.sort((a, b) => {
        // Prioridade 1: display_order (menor primeiro)
        if (a.display_order !== b.display_order) {
            return a.display_order - b.display_order;
        }
        
        // Prioridade 2: Banners Promocionais (sempre vêm antes dos eventos se a ordem for igual)
        if (a.type === 'promotional' && b.type === 'event') return -1;
        if (a.type === 'event' && b.type === 'promotional') return 1;

        // Prioridade 3: Eventos Próximos (dentro do threshold)
        const aIsPriority = a.type === 'event' && (a as any).isUpcomingPriority;
        const bIsPriority = b.type === 'event' && (b as any).isUpcomingPriority;
        
        if (aIsPriority && !bIsPriority) return -1;
        if (!aIsPriority && bIsPriority) return 1;
        
        // Prioridade 4: Data do Evento (mais próximo primeiro)
        if (a.type === 'event' && b.type === 'event' && a.event_date && b.event_date) {
            return isBefore(a.event_date, b.event_date) ? -1 : 1;
        }

        return 0;
    });
    
    // 3. Limitação (Max Banners Display)
    // Retorna apenas o número máximo configurado de banners
    return combinedBanners.slice(0, settings.max_banners_display);
};

export const useCarouselBanners = () => {
    const { settings, isLoading: isLoadingSettings } = useCarouselSettings();
    
    const query = useQuery({
        queryKey: ['carouselBanners', settings],
        queryFn: () => fetchAndProcessBanners(settings),
        enabled: !isLoadingSettings, // Só executa se as configurações estiverem carregadas
        staleTime: 1000 * 60 * 5, // 5 minutes
        onError: (error) => {
            console.error("Query Error: Failed to load carousel banners.", error);
            showError("Erro ao carregar banners do carrossel.");
        }
    });

    return {
        ...query,
        banners: query.data || [],
        isLoading: isLoadingSettings || query.isLoading,
    };
};
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';

export interface EventCarouselBannerSummary {
    id: string;
    headline: string | null;
    start_date: string;
    end_date: string;
}

export function isEventCarouselBannerActive(
    startDate: string | Date | null | undefined,
    endDate: string | Date | null | undefined,
    referenceDate: Date = new Date(),
): boolean {
    if (!startDate || !endDate) return false;
    const ref = format(referenceDate, 'yyyy-MM-dd');
    const start = typeof startDate === 'string' ? startDate.slice(0, 10) : format(startDate, 'yyyy-MM-dd');
    const end = typeof endDate === 'string' ? endDate.slice(0, 10) : format(endDate, 'yyyy-MM-dd');
    return start <= ref && end >= ref;
}

/** Retorna o banner já cadastrado para o evento (máx. 1 por evento). */
export async function fetchEventCarouselBannerByEvent(
    eventId: string,
): Promise<EventCarouselBannerSummary | null> {
    const { data, error } = await supabase
        .from('event_carousel_banners')
        .select('id, headline, start_date, end_date')
        .eq('event_id', eventId)
        .maybeSingle();

    if (error) throw error;
    return data as EventCarouselBannerSummary | null;
}

/** Mensagem amigável — regra: 1 banner por evento. */
export const EVENT_CAROUSEL_DUPLICATE_EVENT_MESSAGE =
    'Este evento já possui um banner no carrossel. Cada evento permite apenas 1 banner — escolha outro evento ou ajuste o banner existente.';

/** Quando o banner existente ainda está em exibição. */
export const EVENT_CAROUSEL_ACTIVE_BANNER_MESSAGE =
    'Este evento já tem um banner em exibição no carrossel. Aguarde o fim do período ou altere as datas do banner existente.';

export function formatEventCarouselBannerError(error: unknown): string {
    const row =
        error && typeof error === 'object'
            ? (error as { code?: string; message?: string })
            : {};
    const code = row.code ?? '';
    const message = row.message ?? (error instanceof Error ? error.message : '');

    if (
        code === '23505' ||
        message.includes('event_carousel_banners_event_id_key') ||
        message.includes('duplicate key')
    ) {
        return EVENT_CAROUSEL_DUPLICATE_EVENT_MESSAGE;
    }

    if (message.includes('banner ativo') || message.includes('já possui um banner ativo')) {
        return EVENT_CAROUSEL_ACTIVE_BANNER_MESSAGE;
    }

    return 'Não foi possível criar o banner. Verifique os dados e tente novamente.';
}

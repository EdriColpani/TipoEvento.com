import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';

export interface EventCarouselBannerSummary {
    id: string;
    headline: string | null;
    start_date: string;
    end_date: string;
}

/** Período de exibição vigente (inclusive hoje). Usado em evento e promocional no carrossel. */
export function isCarouselBannerDisplayActive(
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

/** @deprecated Use isCarouselBannerDisplayActive */
export const isEventCarouselBannerActive = isCarouselBannerDisplayActive;

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

export type EventCarouselBannerStatus = 'active' | 'scheduled' | 'ended';

export function getEventCarouselBannerStatus(
    startDate: string,
    endDate: string,
    referenceDate: Date = new Date(),
): EventCarouselBannerStatus {
    const ref = format(referenceDate, 'yyyy-MM-dd');
    const start = startDate.slice(0, 10);
    const end = endDate.slice(0, 10);
    if (end < ref) return 'ended';
    if (start > ref) return 'scheduled';
    return 'active';
}

export const EVENT_CAROUSEL_BANNER_STATUS_LABELS: Record<EventCarouselBannerStatus, string> = {
    active: 'Em exibição',
    scheduled: 'Agendado',
    ended: 'Encerrado',
};

/** Mensagem amigável — regra: 1 banner por evento. */
export const EVENT_CAROUSEL_DUPLICATE_EVENT_MESSAGE =
    'Este evento já possui um banner no carrossel. Acesse "Banners de Evento" para editar ou remover o banner atual.';

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

    if (
        code === '42501' ||
        message.includes('row-level security') ||
        message.includes('violates row-level security')
    ) {
        return 'Sem permissão para salvar este banner. Verifique se você é gestor do evento ou administrador master.';
    }

    return 'Não foi possível salvar o banner. Verifique os dados e tente novamente.';
}

/** Encerra exibição definindo a data de fim para ontem (timezone local do navegador). */
export function getYesterdayIsoDate(referenceDate: Date = new Date()): string {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() - 1);
    return format(d, 'yyyy-MM-dd');
}

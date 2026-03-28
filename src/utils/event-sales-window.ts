import { parseEventLocalDay } from './format-event-date';

/**
 * Interpreta `time` do evento (HH:mm ou HH:mm:ss). Vazio → início do dia (00:00) no mesmo calendário que `date`.
 * A comparação usa o relógio local do navegador; o servidor (RPC `event_accepts_new_sales`) usa America/Sao_Paulo.
 * Para usuários fora do BR pode haver diferença pequena; a Edge Function e a RPC são a fonte da verdade.
 */
function parseEventTimeParts(timeStr: string | null | undefined): { h: number; m: number; s: number } {
    const t = (timeStr ?? '').trim();
    if (!t) {
        return { h: 0, m: 0, s: 0 };
    }
    const parts = t.split(':').map((p) => parseInt(p.replace(/\D/g, ''), 10));
    const h = Number.isFinite(parts[0]) ? Math.min(23, Math.max(0, parts[0])) : 0;
    const m = Number.isFinite(parts[1]) ? Math.min(59, Math.max(0, parts[1])) : 0;
    const s = Number.isFinite(parts[2]) ? Math.min(59, Math.max(0, parts[2])) : 0;
    return { h, m, s };
}

/** Instante de início do evento no fuso local do dispositivo (mesma intenção que date+time no cadastro). */
export function getEventStartDateTime(
    dateStr: string | null | undefined,
    timeStr: string | null | undefined,
): Date | null {
    const day = parseEventLocalDay(dateStr);
    if (!day) return null;
    const { h, m, s } = parseEventTimeParts(timeStr);
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, s, 0);
}

/** `true` enquanto for possível iniciar nova compra/inscrição pelo calendário do evento (antes de date+time). */
export function isEventOpenForNewSales(
    dateStr: string | null | undefined,
    timeStr: string | null | undefined,
    now: Date = new Date(),
): boolean {
    const start = getEventStartDateTime(dateStr, timeStr);
    if (!start) return false;
    return now.getTime() < start.getTime();
}

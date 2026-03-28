import { format, parse, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';

/** Primeiros 10 caracteres YYYY-MM-DD (Postgres `date` em JSON). */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Meia-noite no calendário local do dia do evento.
 * Evita `new Date('YYYY-MM-DD')`, que o JS interpreta como UTC e no Brasil pode “voltar” um dia.
 */
export function parseEventLocalDay(dateStr: string | null | undefined): Date | null {
    if (dateStr == null || String(dateStr).trim() === '') return null;
    const d = String(dateStr).trim().slice(0, 10);
    if (DATE_ONLY.test(d)) {
        return parse(d, 'yyyy-MM-dd', new Date(2000, 0, 1));
    }
    const dt = new Date(dateStr);
    return isValid(dt) ? dt : null;
}

/** Exibição pt-BR da data do evento (só dia ou timestamp ISO completo). */
export function formatEventDateForDisplay(dateStr: string | null | undefined): string {
    if (dateStr == null || String(dateStr).trim() === '') return '';
    const d = String(dateStr).trim().slice(0, 10);
    if (DATE_ONLY.test(d)) {
        const localDay = parse(d, 'yyyy-MM-dd', new Date(2000, 0, 1));
        return format(localDay, 'dd/MM/yyyy', { locale: ptBR });
    }
    const dt = new Date(dateStr);
    return isValid(dt) ? format(dt, 'dd/MM/yyyy', { locale: ptBR }) : '';
}

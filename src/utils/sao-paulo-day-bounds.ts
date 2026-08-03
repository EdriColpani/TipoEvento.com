import { format, parse, subDays } from 'date-fns';

/** Limites do dia civil em America/Sao_Paulo (sem DST desde 2019). */
export function getSaoPauloDayBounds(now = new Date()): {
    dayKey: string;
    startIso: string;
    endIso: string;
} {
    const dayKey = saoPauloDayKey(now);

    return {
        dayKey,
        startIso: `${dayKey}T00:00:00-03:00`,
        endIso: `${dayKey}T23:59:59.999-03:00`,
    };
}

/** Dia civil YYYY-MM-DD em America/Sao_Paulo (não depende do fuso do navegador). */
export function saoPauloDayKey(input: Date | string): string {
    const date = typeof input === 'string' ? new Date(input) : input;
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
}

/** Últimos N dias civis SP, do mais antigo ao mais recente (inclui hoje). */
export function buildSaoPauloDateKeys(days: number, now = new Date()): string[] {
    const today = parse(saoPauloDayKey(now), 'yyyy-MM-dd', new Date(2000, 0, 1));
    const keys: string[] = [];
    for (let i = days - 1; i >= 0; i -= 1) {
        keys.push(format(subDays(today, i), 'yyyy-MM-dd'));
    }
    return keys;
}

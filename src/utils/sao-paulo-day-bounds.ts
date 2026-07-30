/** Limites do dia civil em America/Sao_Paulo (sem DST desde 2019). */
export function getSaoPauloDayBounds(now = new Date()): {
    dayKey: string;
    startIso: string;
    endIso: string;
} {
    const dayKey = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(now);

    return {
        dayKey,
        startIso: `${dayKey}T00:00:00-03:00`,
        endIso: `${dayKey}T23:59:59.999-03:00`,
    };
}

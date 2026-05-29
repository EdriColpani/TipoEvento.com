export const MAX_EVENT_HIGHLIGHTS = 10;
export const MAX_EVENT_HIGHLIGHT_LENGTH = 120;

/** Converte textarea (uma linha por destaque) em array para o banco. */
export function parseHighlightsText(text: string | null | undefined): string[] {
    if (!text?.trim()) return [];

    const lines = text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    const unique: string[] = [];
    for (const line of lines) {
        const item = line.slice(0, MAX_EVENT_HIGHLIGHT_LENGTH);
        if (!unique.includes(item)) {
            unique.push(item);
        }
        if (unique.length >= MAX_EVENT_HIGHLIGHTS) break;
    }

    return unique;
}

/** Converte array do banco em texto para o textarea do gestor. */
export function highlightsToText(highlights: string[] | null | undefined): string {
    if (!highlights?.length) return '';
    return highlights.join('\n');
}

export function validateHighlightsText(text: string | null | undefined): string | null {
    const lines = (text ?? '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

    if (lines.length > MAX_EVENT_HIGHLIGHTS) {
        return `Use no máximo ${MAX_EVENT_HIGHLIGHTS} destaques (um por linha).`;
    }

    const tooLong = lines.find((l) => l.length > MAX_EVENT_HIGHLIGHT_LENGTH);
    if (tooLong) {
        return `Cada destaque pode ter no máximo ${MAX_EVENT_HIGHLIGHT_LENGTH} caracteres.`;
    }

    return null;
}

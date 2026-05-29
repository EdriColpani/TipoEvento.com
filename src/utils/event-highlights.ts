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

/**
 * Normaliza o valor vindo do Supabase/Postgres (text[], text com JSON, etc.).
 */
export function parseHighlightsFromDb(value: unknown): string[] {
    if (value == null) return [];

    if (Array.isArray(value)) {
        return value
            .map((item) => {
                if (typeof item === 'string') return item.trim();
                if (item != null) return String(item).trim();
                return '';
            })
            .filter(Boolean);
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return [];

        if (trimmed.startsWith('[')) {
            try {
                return parseHighlightsFromDb(JSON.parse(trimmed) as unknown);
            } catch {
                /* fallthrough */
            }
        }

        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            const pgArrayInner = trimmed.slice(1, -1);
            if (pgArrayInner) {
                return pgArrayInner
                    .split(',')
                    .map((part) => part.trim().replace(/^"|"$/g, '').replace(/^'|'$/g, ''))
                    .filter(Boolean);
            }
            return [];
        }

        return trimmed
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
    }

    return [];
}

/** Converte array do banco em texto para o textarea do gestor. */
export function highlightsToText(highlights: unknown): string {
    const items = parseHighlightsFromDb(highlights);
    if (!items.length) return '';
    return items.join('\n');
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

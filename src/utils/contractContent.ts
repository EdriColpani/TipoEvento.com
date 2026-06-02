/** Classes compartilhadas para renderização HTML de contratos. */
export const CONTRACT_HTML_PROSE_CLASS =
    'prose prose-invert max-w-none break-words text-gray-300 ' +
    '[&_h2]:mt-8 [&_h2]:mb-4 [&_h2]:text-yellow-500/95 ' +
    '[&_h3]:mt-6 [&_h3]:mb-3 [&_h3]:text-yellow-500/90 ' +
    '[&_p]:my-4 [&_p]:leading-relaxed ' +
    '[&_ul]:my-4 [&_ol]:my-4';

/**
 * Normaliza conteúdo de contrato vindo do PostgreSQL.
 * Em literais SQL com aspas simples ('...'), `\n` é armazenado como dois caracteres
 * (backslash + "n"), não como quebra de linha — aparece literalmente na UI.
 */
export function normalizeContractContentForDisplay(content: string): string {
    if (!content) return content;
    return content
        .replace(/\\r\\n/g, "\n")
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\n")
        .replace(/\\t/g, "\t");
}

export function looksLikeContractHtml(content: string): boolean {
    return /^</.test(content.trim());
}

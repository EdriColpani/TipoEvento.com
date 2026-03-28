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

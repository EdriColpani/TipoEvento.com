/** Classes compartilhadas para renderização HTML de contratos (landing / registro). */
export const CONTRACT_HTML_PROSE_CLASS =
    'prose prose-invert max-w-none break-words text-gray-300 ' +
    '[&_h2]:mt-8 [&_h2]:mb-4 [&_h2]:text-yellow-500/95 ' +
    '[&_h3]:mt-6 [&_h3]:mb-3 [&_h3]:text-yellow-500/90 ' +
    '[&_h4]:mt-4 [&_h4]:mb-2 [&_h4]:text-yellow-500/85 ' +
    '[&_p]:my-3 [&_p]:leading-relaxed ' +
    '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 ' +
    '[&_li]:my-1 [&_strong]:text-white/95';

/** Variante ciano para modais de plano/cobrança do gestor. */
export const CONTRACT_HTML_PROSE_BILLING_CLASS =
    'prose prose-invert max-w-none break-words text-gray-300 text-sm ' +
    '[&_h2]:mt-6 [&_h2]:mb-3 [&_h2]:text-cyan-400 [&_h2]:text-lg [&_h2]:font-semibold ' +
    '[&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-cyan-300/95 [&_h3]:text-base [&_h3]:font-semibold ' +
    '[&_h4]:mt-4 [&_h4]:mb-2 [&_h4]:text-cyan-200/90 [&_h4]:text-sm [&_h4]:font-medium ' +
    '[&_p]:my-3 [&_p]:leading-relaxed [&_p]:text-gray-300 ' +
    '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 ' +
    '[&_li]:my-1 [&_strong]:text-white/95';

/**
 * Normaliza conteúdo de contrato vindo do PostgreSQL.
 * Em literais SQL com aspas simples ('...'), `\n` é armazenado como dois caracteres
 * (backslash + "n"), não como quebra de linha — aparece literalmente na UI.
 */
export function normalizeContractContentForDisplay(content: string): string {
    if (!content) return content;
    return content
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\n')
        .replace(/\\t/g, '\t');
}

export function looksLikeContractHtml(content: string): boolean {
    return /^</.test(content.trim());
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Insere quebras em texto corrido típico de contratos jurídicos colados sem HTML. */
function insertBreaksInPlainContractWall(text: string): string {
    let result = text.replace(/\r\n/g, '\n').trim();

    result = result.replace(
        /\s+(CONTRATO DE ADESÃO[\s\S]*?)(?=\s+CONTRATADA:|\s+CONTRATANTE:|\s+CLÁUSULA|\s+CLAUSULA|$)/gi,
        '\n\n$1\n\n',
    );

    result = result.replace(/\s+(CLÁUSULA\s+[A-ZÀ-Ú0-9\s\-–—]+:)/gi, '\n\n$1\n');

    result = result.replace(/\s+(CLAUSULA\s+[A-ZÀ-Ú0-9\s\-–—]+:)/gi, '\n\n$1\n');

    result = result.replace(/(?<=[.;!?])\s+(\d+\.\d+\s+)/g, '\n\n$1');

    result = result.replace(/\s+(CONTRATADA:)/gi, '\n\n$1 ');
    result = result.replace(/\s+(CONTRATANTE:)/gi, '\n\n$1 ');

    return result.replace(/\n{3,}/g, '\n\n').trim();
}

function formatPlainTextParagraphBlock(block: string): string {
    const trimmed = block.trim();
    if (!trimmed) return '';

    const singleLine = trimmed.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();

    if (/^CONTRATO DE ADESÃO|^CONTRATO DE|^TERMO DE/i.test(singleLine) && singleLine.length <= 220) {
        return `<h2>${escapeHtml(singleLine)}</h2>`;
    }

    if (/^CLÁUSULA|^CLAUSULA/i.test(singleLine)) {
        const clauseMatch = singleLine.match(/^(CLÁUSULA\s+[A-ZÀ-Ú0-9\s\-–—]+:)\s*(.*)$/i);
        if (clauseMatch) {
            const heading = escapeHtml(clauseMatch[1].trim());
            const body = clauseMatch[2]?.trim();
            return `<h3>${heading}</h3>${body ? `<p>${escapeHtml(body)}</p>` : ''}`;
        }
        return `<h3>${escapeHtml(singleLine)}</h3>`;
    }

    const numberedMatch = singleLine.match(/^(\d+\.\d+)\s+(.+)$/);
    if (numberedMatch) {
        return `<p><strong>${escapeHtml(numberedMatch[1])}</strong> ${escapeHtml(numberedMatch[2])}</p>`;
    }

    if (/^(CONTRATADA|CONTRATANTE):/i.test(singleLine)) {
        const parts = singleLine.match(/^((?:CONTRATADA|CONTRATANTE):)\s*(.*)$/i);
        if (parts) {
            return `<p><strong>${escapeHtml(parts[1])}</strong> ${escapeHtml(parts[2])}</p>`;
        }
    }

    if (trimmed.includes('\n')) {
        return trimmed
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => formatPlainTextParagraphBlock(line))
            .join('');
    }

    const listItems = singleLine.split(/;\s+(?=[a-záàâãéêíóôõúçA-Z0-9])/);
    if (listItems.length >= 3 && singleLine.includes(';')) {
        return `<ul>${listItems.map((item) => `<li>${escapeHtml(item.trim())}</li>`).join('')}</ul>`;
    }

    return `<p>${escapeHtml(singleLine)}</p>`;
}

function plainTextContractToHtml(text: string): string {
    let normalized = text.replace(/\r\n/g, '\n').trim();

    if (!/\n\s*\n/.test(normalized)) {
        normalized = insertBreaksInPlainContractWall(normalized);
    }

    if (!/\n\s*\n/.test(normalized) && normalized.includes('\n')) {
        normalized = normalized
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .join('\n\n');
    }

    if (!/\n\s*\n/.test(normalized)) {
        return formatPlainTextParagraphBlock(normalized);
    }

    return normalized
        .split(/\n\s*\n/)
        .map((block) => formatPlainTextParagraphBlock(block))
        .filter(Boolean)
        .join('\n');
}

/**
 * Prepara conteúdo de contrato para exibição HTML.
 * - HTML existente (<h2>, <p>…): preserva e normaliza quebras escapadas.
 * - Texto puro: converte em parágrafos, cláusulas e itens numerados legíveis.
 */
export function prepareContractContentForHtmlDisplay(content: string): string {
    const normalized = normalizeContractContentForDisplay(content).trim();
    if (!normalized) return '';

    if (looksLikeContractHtml(normalized)) {
        return normalized;
    }

    return plainTextContractToHtml(normalized);
}

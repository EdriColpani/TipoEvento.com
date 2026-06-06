/**
 * Copia texto para a área de transferência.
 * Em HTTP (sem secure context) navigator.clipboard falha — usa execCommand como fallback.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
    const value = text.trim();
    if (!value) return false;

    if (typeof window !== 'undefined' && window.isSecureContext && navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(value);
            return true;
        } catch {
            /* tenta fallback abaixo */
        }
    }

    try {
        const textArea = document.createElement('textarea');
        textArea.value = value;
        textArea.setAttribute('readonly', '');
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        textArea.setSelectionRange(0, value.length);
        const ok = document.execCommand('copy');
        document.body.removeChild(textArea);
        return ok;
    } catch {
        return false;
    }
}

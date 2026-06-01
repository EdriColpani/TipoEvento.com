/** Exibe telefone brasileiro a partir de dígitos ou string já formatada. */
export function formatPhoneBR(raw: string | null | undefined): string {
    const digits = String(raw ?? '').replace(/\D/g, '');
    if (digits.length === 11) return digits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    if (digits.length === 10) return digits.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    return raw ? String(raw) : 'Não informado';
}

/** Máscara progressiva: (XX) XXXXX-XXXX (celular) ou (XX) XXXX-XXXX (fixo). */
export function formatPhoneInput(value: string): string {
    const clean = value.replace(/\D/g, '').slice(0, 11);
    if (clean.length === 0) return '';
    if (clean.length <= 2) return `(${clean}`;
    if (clean.length <= 6) return `(${clean.slice(0, 2)}) ${clean.slice(2)}`;
    if (clean.length <= 10) {
        return `(${clean.slice(0, 2)}) ${clean.slice(2, 6)}-${clean.slice(6)}`;
    }
    return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7)}`;
}

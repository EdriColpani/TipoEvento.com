/** Remove máscara de CPF, RG, CEP etc. */
export function normalizeDocumentDigits(value: string | null | undefined): string {
    return (value ?? '').replace(/\D/g, '');
}

export function isSameDocument(
    stored: string | null | undefined,
    submitted: string | null | undefined,
): boolean {
    const a = normalizeDocumentDigits(stored);
    const b = normalizeDocumentDigits(submitted);
    if (!a && !b) return true;
    return a === b && a.length > 0;
}

/** Mensagens amigáveis para erros comuns ao salvar profiles. */
export function translateProfileSaveError(error: { code?: string; message?: string } | null): string {
    if (!error) return 'Erro desconhecido ao salvar o perfil.';

    if (error.code === '23505') {
        const msg = error.message ?? '';
        if (msg.includes('profiles_cpf') || msg.toLowerCase().includes('cpf')) {
            return 'Este CPF já está cadastrado em outra conta da plataforma (pode ser um cadastro antigo de teste ou outro perfil com o mesmo documento). Se for sua conta, entre com o e-mail original ou fale com o suporte.';
        }
        if (msg.includes('rg')) {
            return 'Este RG já está cadastrado em outra conta da plataforma.';
        }
    }

    return error.message || 'Erro desconhecido ao salvar o perfil.';
}

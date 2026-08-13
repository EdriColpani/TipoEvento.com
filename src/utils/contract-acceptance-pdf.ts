import { supabase } from '@/integrations/supabase/client';

export const CONTRACT_ACCEPTANCE_PDF_BUCKET = 'contract-acceptance-pdfs';

export async function createContractAcceptancePdfSignedUrl(
    path: string,
    expiresInSeconds = 120,
): Promise<string> {
    const { data, error } = await supabase.storage
        .from(CONTRACT_ACCEPTANCE_PDF_BUCKET)
        .createSignedUrl(path, expiresInSeconds);

    if (error || !data?.signedUrl) {
        throw new Error(error?.message ?? 'Não foi possível gerar o link do PDF do contrato.');
    }
    return data.signedUrl;
}

export async function openContractAcceptancePdf(path: string): Promise<void> {
    const url = await createContractAcceptancePdfSignedUrl(path);
    window.open(url, '_blank', 'noopener,noreferrer');
}

export async function downloadContractAcceptancePdf(
    path: string,
    fileName?: string | null,
): Promise<void> {
    const url = await createContractAcceptancePdfSignedUrl(path);
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.download = fileName || path.split('/').pop() || 'contrato-aceite.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
}

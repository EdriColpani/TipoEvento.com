import { supabase } from '@/integrations/supabase/client';
import {
    removeStorageObjectRest,
    uploadStorageObjectRest,
} from '@/utils/supabase-storage-rest';

export const SETTLEMENT_PROOF_BUCKET = 'settlement-proofs';

const ALLOWED_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
]);

const MAX_BYTES = 10 * 1024 * 1024;

export function assertSettlementProofFile(file: File): void {
    if (!ALLOWED_TYPES.has(file.type)) {
        throw new Error('Envie imagem (JPG, PNG, WEBP, GIF) ou PDF do comprovante.');
    }
    if (file.size <= 0 || file.size > MAX_BYTES) {
        throw new Error('Arquivo inválido ou maior que 10 MB.');
    }
}

function fileExtension(file: File): string {
    const fromName = file.name.split('.').pop()?.toLowerCase();
    if (fromName && /^[a-z0-9]{1,5}$/.test(fromName)) return fromName;
    if (file.type === 'application/pdf') return 'pdf';
    if (file.type === 'image/png') return 'png';
    if (file.type === 'image/webp') return 'webp';
    if (file.type === 'image/gif') return 'gif';
    return 'jpg';
}

/** Path: `{companyId}/{uuid}.{ext}` — pasta = company_id (RLS Storage). */
export async function uploadSettlementPaymentProof(
    companyId: string,
    file: File,
): Promise<{ path: string; fileName: string }> {
    assertSettlementProofFile(file);
    const ext = fileExtension(file);
    const path = `${companyId}/${crypto.randomUUID()}.${ext}`;
    await uploadStorageObjectRest(SETTLEMENT_PROOF_BUCKET, path, file);
    return { path, fileName: file.name };
}

export async function removeSettlementPaymentProof(path: string): Promise<void> {
    await removeStorageObjectRest(SETTLEMENT_PROOF_BUCKET, path);
}

export async function createSettlementProofSignedUrl(
    path: string,
    expiresInSeconds = 120,
): Promise<string> {
    const { data, error } = await supabase.storage
        .from(SETTLEMENT_PROOF_BUCKET)
        .createSignedUrl(path, expiresInSeconds);

    if (error || !data?.signedUrl) {
        throw new Error(error?.message ?? 'Não foi possível gerar o link do comprovante.');
    }
    return data.signedUrl;
}

export async function downloadSettlementPaymentProof(
    path: string,
    fileName?: string | null,
): Promise<void> {
    const url = await createSettlementProofSignedUrl(path);
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    if (fileName) a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

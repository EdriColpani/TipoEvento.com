import type { PlatformContractType } from '@/constants/event-contracts';
import { restGetAuthOrPublic } from '@/utils/supabase-rest';

export interface PlatformContractRow {
    id: string;
    version: string;
    title: string;
    content: string;
    contract_type: string;
    is_active: boolean;
}

/** Contrato ativo de plataforma (ex.: cadastro gestor, termos do cliente). */
export async function fetchActivePlatformContract(
    contractType: PlatformContractType,
): Promise<PlatformContractRow | null> {
    const rows = await restGetAuthOrPublic<PlatformContractRow[]>(
        `event_contracts?contract_type=eq.${encodeURIComponent(contractType)}&is_active=eq.true&select=id,version,title,content,contract_type,is_active&limit=1`,
        12_000,
    );

    return rows[0] ?? null;
}

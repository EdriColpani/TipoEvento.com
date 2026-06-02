import { supabase } from '@/integrations/supabase/client';
import type { PlatformContractType } from '@/constants/event-contracts';

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
    const { data, error } = await supabase
        .from('event_contracts')
        .select('id, version, title, content, contract_type, is_active')
        .eq('contract_type', contractType)
        .eq('is_active', true)
        .maybeSingle();

    if (error && error.code !== 'PGRST116') {
        throw new Error(error.message);
    }

    return (data as PlatformContractRow | null) ?? null;
}

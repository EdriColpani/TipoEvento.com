import { restGet } from '@/utils/supabase-rest';

/** Versão do contrato aceito na empresa (auditoria em eventos). */
export async function fetchEventContractVersion(contractId: string): Promise<string | null> {
    try {
        const rows = await restGet<{ version: string }[]>(
            `event_contracts?id=eq.${contractId}&select=version&limit=1`,
            6_000,
        );
        return rows?.[0]?.version ?? null;
    } catch {
        return null;
    }
}

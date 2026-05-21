import { supabase } from '@/integrations/supabase/client';
import type { BillingPlanCode } from '@/constants/billing-plans';
import { getContractTypesForBillingPlan } from '@/constants/event-contracts';

export interface BillingPlanContractRow {
    id: string;
    version: string;
    title: string;
    content: string;
    contract_type: string;
    is_active: boolean;
}

function pickBestContract(rows: BillingPlanContractRow[]): BillingPlanContractRow | null {
    if (!rows.length) return null;
    const active = rows.find((r) => r.is_active);
    return active ?? rows[0];
}

/** Busca via RPC (SECURITY DEFINER — não depende de RLS em event_contracts). */
async function fetchViaRpc(plan: BillingPlanCode): Promise<BillingPlanContractRow | null> {
    const { data, error } = await supabase.rpc('get_event_contract_for_billing_plan', {
        p_plan: plan,
    });

    if (error) {
        // Função ainda não aplicada no banco — caller usa fallback
        if (error.code === 'PGRST202' || error.message?.includes('Could not find the function')) {
            return null;
        }
        throw new Error(error.message);
    }

    if (!data || typeof data !== 'object') return null;
    return data as BillingPlanContractRow;
}

/** Fallback: leitura direta na tabela (requer policy SELECT para authenticated). */
async function fetchViaTable(plan: BillingPlanCode): Promise<BillingPlanContractRow | null> {
    const types = getContractTypesForBillingPlan(plan);

    const { data, error } = await supabase
        .from('event_contracts')
        .select('id, version, title, content, contract_type, is_active')
        .in('contract_type', types)
        .order('is_active', { ascending: false })
        .order('updated_at', { ascending: false });

    if (error) {
        if (error.code === '42501' || error.message?.includes('permission') || error.message?.includes('policy')) {
            throw new Error(
                'Sem permissão para ler contratos. O administrador precisa aplicar as migrations mais recentes do Supabase.',
            );
        }
        throw new Error(error.message);
    }

    return pickBestContract((data ?? []) as BillingPlanContractRow[]);
}

/** Contrato ativo (ou o mais recente) para um plano comercial. */
export async function fetchBillingPlanContract(plan: BillingPlanCode): Promise<BillingPlanContractRow | null> {
    try {
        const fromRpc = await fetchViaRpc(plan);
        if (fromRpc) return fromRpc;
    } catch (e) {
        console.warn('[fetchBillingPlanContract] RPC falhou, tentando tabela:', e);
    }

    return fetchViaTable(plan);
}

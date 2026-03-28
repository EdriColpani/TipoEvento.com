import type { SupabaseClient } from '@supabase/supabase-js';

export interface ManagerEventScopeRow {
    id: string;
    title: string;
    /** Só preenchido se a coluna existir no banco; caso contrário trate como false. */
    is_draft?: boolean;
    /** Quando false, evento desativado (fora da vitrine / sem novas vendas). Default true se coluna ausente. */
    is_active?: boolean;
    date: string | null;
    time: string | null;
    duration: string | null;
    company_id: string | null;
    created_at: string;
}

function normalizeRow(raw: Record<string, unknown>): ManagerEventScopeRow {
    const dateVal = raw.date ?? raw.event_date;
    const timeVal = raw.time ?? raw.event_time;
    return {
        id: String(raw.id),
        title: String(raw.title ?? ''),
        is_draft: raw.is_draft === true,
        is_active: raw.is_active === false ? false : true,
        date: dateVal != null && dateVal !== '' ? String(dateVal) : null,
        time: timeVal != null && timeVal !== '' ? String(timeVal) : null,
        duration: raw.duration != null && raw.duration !== '' ? String(raw.duration) : null,
        company_id: raw.company_id != null && raw.company_id !== '' ? String(raw.company_id) : null,
        created_at: raw.created_at != null && raw.created_at !== '' ? String(raw.created_at) : '',
    };
}

export type FetchManagerEventsScopeOptions = {
    /** Quando definido, restringe a linhas com `events.created_by` igual a este usuário. */
    createdByUserId?: string;
};

/**
 * Tenta SELECT em `events` com projeções compatíveis com esquemas diferentes (date/time vs event_date/event_time, created_at opcional).
 * PostgREST retorna erro se qualquer coluna listada não existir — por isso várias tentativas.
 */
async function fetchEventsWithSchemaFallback(
    client: SupabaseClient,
    options?: FetchManagerEventsScopeOptions,
): Promise<ManagerEventScopeRow[]> {
    const attempts = [
        'id, title, date, time, duration, company_id, created_at, is_draft, is_active',
        'id, title, date, time, duration, company_id, created_at, is_active',
        'id, title, date, time, duration, company_id, is_active',
        'id, title, event_date, event_time, duration, company_id, created_at, is_active',
        'id, title, event_date, event_time, duration, company_id, is_active',
        'id, title, date, time, duration, is_active',
        'id, title, event_date, event_time, duration, is_active',
        'id, title, date, time, is_active',
        'id, title, event_date, event_time, is_active',
        'id, title, is_active',
        '*',
    ];

    let lastMessage = '';

    for (const selectList of attempts) {
        let q = client.from('events').select(selectList).order('id', { ascending: true });
        if (options?.createdByUserId) {
            q = q.eq('created_by', options.createdByUserId);
        }
        const { data, error } = await q;

        if (error) {
            lastMessage = error.message;
            continue;
        }

        const rawRows = (data as Record<string, unknown>[]) ?? [];
        return rawRows.map(normalizeRow);
    }

    throw new Error(
        lastMessage ||
            'Não foi possível ler a tabela events. Verifique colunas e políticas RLS no Supabase.',
    );
}

/**
 * Lista eventos na área do gestor:
 * - **Admin Master** (`isAdminMaster`): todos os eventos (gestão global).
 * - **Gestor PRO**: somente eventos com `created_by = userId` (não vê eventos de outros gestores nem os criados pelo admin, desde que `created_by` esteja preenchido).
 *
 * Observação: eventos antigos com `created_by` nulo não aparecem para o gestor até backfill; o admin master continua vendo todos.
 */
export async function fetchEventsVisibleToGestor(
    client: SupabaseClient,
    userId: string,
    isAdminMaster: boolean,
): Promise<ManagerEventScopeRow[]> {
    if (!isAdminMaster) {
        return fetchEventsWithSchemaFallback(client, { createdByUserId: userId });
    }
    return fetchEventsWithSchemaFallback(client);
}

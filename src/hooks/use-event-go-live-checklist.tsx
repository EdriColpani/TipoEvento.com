import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { callRpcRest } from '@/utils/supabase-rest-rpc';

export type GoLiveItemStatus = 'pass' | 'fail' | 'warning' | 'pending';

export type GoLiveChecklistItem = {
    key: string;
    label: string;
    kind: 'auto' | 'manual';
    required: boolean;
    status: GoLiveItemStatus;
    message?: string;
    acknowledged?: boolean;
    notes?: string | null;
    details?: Record<string, unknown>;
};

export type GoLiveChecklist = {
    ok: boolean;
    applies: boolean;
    event_id?: string;
    event_title?: string;
    is_active?: boolean;
    ready?: boolean;
    auto_ready?: boolean;
    auto_ready_count?: number;
    auto_required_count?: number;
    ready_count?: number;
    required_count?: number;
    message?: string;
    items?: GoLiveChecklistItem[];
    runbook_path?: string;
    load_test_path?: string;
};

async function fetchGoLiveChecklist(eventId: string): Promise<GoLiveChecklist> {
    return callRpcRest<GoLiveChecklist>(
        'get_event_go_live_checklist',
        { p_event_id: eventId },
        15_000,
    );
}

async function setAcknowledgement(params: {
    eventId: string;
    itemKey: string;
    acknowledged: boolean;
    notes?: string;
}): Promise<GoLiveChecklist> {
    return callRpcRest<GoLiveChecklist>(
        'set_event_go_live_acknowledgement',
        {
            p_event_id: params.eventId,
            p_item_key: params.itemKey,
            p_acknowledged: params.acknowledged,
            p_notes: params.notes ?? null,
        },
        15_000,
    );
}

export function useEventGoLiveChecklist(eventId: string | undefined, enabled = true) {
    return useQuery({
        queryKey: ['eventGoLiveChecklist', eventId],
        enabled: Boolean(eventId) && enabled,
        staleTime: 30_000,
        queryFn: () => fetchGoLiveChecklist(eventId!),
    });
}

export function useSetGoLiveAcknowledgement(eventId: string | undefined) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: setAcknowledgement,
        onSuccess: (data) => {
            queryClient.setQueryData(['eventGoLiveChecklist', eventId], data);
            void queryClient.invalidateQueries({ queryKey: ['eventGoLiveChecklist', eventId] });
        },
    });
}

export async function fetchGoLiveChecklistOnce(eventId: string): Promise<GoLiveChecklist> {
    return fetchGoLiveChecklist(eventId);
}

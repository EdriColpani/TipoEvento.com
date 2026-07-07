import { callRpcRest } from '@/utils/supabase-rest-rpc';

export type ComplimentaryBundleRow = {
    id: string;
    recipient_name: string;
    recipient_email: string | null;
    quantity: number;
    public_token: string;
    status: string;
    expires_at: string;
    created_at: string;
    batch_name: string;
    redeemed_count: number;
    available_count: number;
    holder_claimed: boolean;
    email_sent_at: string | null;
};

type BundlesPayload = {
    ok?: boolean;
    bundles?: ComplimentaryBundleRow[];
    error?: string;
};

export async function listComplimentaryBundles(eventId: string): Promise<ComplimentaryBundleRow[]> {
    const payload = await callRpcRest<BundlesPayload>(
        'list_complimentary_bundles',
        { p_event_id: eventId },
        12_000,
    );
    if (!payload?.ok) {
        throw new Error(payload?.error ?? 'Erro ao listar pacotes.');
    }
    return payload.bundles ?? [];
}

export async function createComplimentaryBundle(input: {
    eventId: string;
    batchId: string;
    recipientName: string;
    recipientEmail: string | null;
    quantity: number;
    expiresDays: number;
    notes: string | null;
}) {
    return callRpcRest<{
        ok?: boolean;
        error?: string;
        public_token?: string;
        available?: number;
    }>(
        'create_complimentary_bundle',
        {
            p_event_id: input.eventId,
            p_batch_id: input.batchId,
            p_recipient_name: input.recipientName,
            p_recipient_email: input.recipientEmail,
            p_quantity: input.quantity,
            p_expires_days: input.expiresDays,
            p_notes: input.notes,
        },
        15_000,
    );
}

export async function resetComplimentaryBundleHolder(bundleId: string) {
    return callRpcRest<{ ok?: boolean; error?: string; redeemed_count?: number }>(
        'reset_complimentary_bundle_holder',
        { p_bundle_id: bundleId },
        12_000,
    );
}

export async function cancelComplimentaryBundle(bundleId: string) {
    return callRpcRest<{ ok?: boolean; error?: string }>(
        'cancel_complimentary_bundle',
        { p_bundle_id: bundleId },
        12_000,
    );
}

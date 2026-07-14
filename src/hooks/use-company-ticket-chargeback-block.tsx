import { useQuery } from '@tanstack/react-query';
import { callRpcRest } from '@/utils/supabase-rest-rpc';

export type TicketChargebackBlockItem = {
    id: string;
    created_at: string;
    amount_remaining: number;
    recovery_mode: string | null;
    status: string;
    payment_ref_hint: string | null;
    event_title: string | null;
};

export type TicketChargebackBlockStatus = {
    company_id: string;
    threshold: number;
    open_count: number;
    pending_amount: number;
    oldest_open_at: string | null;
    warning: boolean;
    blocked: boolean;
    remaining_until_block: number;
    contact: {
        phone?: string | null;
        company_name?: string | null;
        instagram_handle?: string | null;
        linkedin_url?: string | null;
    };
    payment_instructions: {
        pix_key?: string | null;
        pix_holder?: string | null;
        instructions?: string | null;
    };
    items: TicketChargebackBlockItem[];
};

export function useCompanyTicketChargebackBlock(
    companyId: string | undefined,
    enabled = true,
) {
    return useQuery({
        queryKey: ['companyTicketChargebackBlock', companyId],
        queryFn: async () => {
            const row = await callRpcRest<TicketChargebackBlockStatus>(
                'get_company_ticket_chargeback_block_status',
                { p_company_id: companyId },
                15_000,
            );
            return {
                ...row,
                open_count: Number(row.open_count ?? 0),
                pending_amount: Number(row.pending_amount ?? 0),
                threshold: Number(row.threshold ?? 3),
                remaining_until_block: Number(row.remaining_until_block ?? 0),
                warning: row.warning === true,
                blocked: row.blocked === true,
                items: Array.isArray(row.items) ? row.items : [],
                contact: row.contact ?? {},
                payment_instructions: row.payment_instructions ?? {},
            } satisfies TicketChargebackBlockStatus;
        },
        enabled: Boolean(companyId) && enabled,
        staleTime: 30_000,
    });
}

export function formatPhoneDisplay(digits: string | null | undefined): string {
    const d = String(digits ?? '').replace(/\D/g, '');
    if (d.length === 11) {
        return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    }
    if (d.length === 10) {
        return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    }
    return digits?.trim() || '';
}

export function buildWhatsAppUrl(phoneDigits: string, text: string): string {
    const d = phoneDigits.replace(/\D/g, '');
    const withCountry = d.startsWith('55') ? d : `55${d}`;
    return `https://wa.me/${withCountry}?text=${encodeURIComponent(text)}`;
}

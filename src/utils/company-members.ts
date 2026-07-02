import { supabase } from '@/integrations/supabase/client';
import type { CompanyMemberRole } from '@/constants/company-roles';
import { callRpc, RpcTimeoutError } from '@/utils/supabase-rpc';

export type CompanyMemberRow = {
    user_id: string;
    role: CompanyMemberRole;
    is_primary: boolean;
    email: string | null;
    display_name: string;
};

export type PendingCompanyInvite = {
    id: string;
    email: string;
    role: CompanyMemberRole;
    created_at: string;
};

function normalizeCnpj(raw: string): string {
    return raw.replace(/\D/g, '');
}

function normalizePhone(raw: string | undefined): string | null {
    const digits = (raw ?? '').replace(/\D/g, '');
    return digits || null;
}

/** Fallback quando a RPC antiga ainda está no banco (travava 20s+). */
async function adminCreatePartnerCompanyDirect(input: {
    cnpj: string;
    corporateName: string;
    tradeName?: string;
    email?: string;
    phone?: string;
    ownerEmail?: string;
}) {
    const cnpj = normalizeCnpj(input.cnpj);
    if (cnpj.length !== 14) {
        throw new Error('CNPJ inválido.');
    }

    const { data: company, error: companyError } = await supabase
        .from('companies')
        .insert({
            cnpj,
            corporate_name: input.corporateName.trim(),
            trade_name: input.tradeName?.trim() || null,
            email: input.email?.trim() || null,
            phone: normalizePhone(input.phone),
            company_kind: 'partner',
            billing_plan: 'consumption_or_license',
            requires_billing_reacceptance: true,
        })
        .select('id')
        .single();

    if (companyError) {
        if (companyError.message?.includes('duplicate') || companyError.code === '23505') {
            throw new Error('CNPJ já cadastrado.');
        }
        throw new Error(companyError.message);
    }

    const companyId = company.id as string;

    const { error: planError } = await supabase.rpc('admin_set_company_billing_plan', {
        p_company_id: companyId,
        p_plan: 'consumption_or_license',
    });
    if (planError) {
        console.warn('[adminCreatePartnerCompanyDirect] admin_set_company_billing_plan:', planError.message);
    }

    const ownerEmail = (input.ownerEmail || input.email || '').trim().toLowerCase();
    let ownerInvite: { linked_immediately?: boolean; message?: string } | undefined;

    if (ownerEmail && ownerEmail.includes('@')) {
        const { error: inviteError } = await supabase.from('company_member_invites').insert({
            company_id: companyId,
            email: ownerEmail,
            role: 'owner',
        });
        if (inviteError && !inviteError.message?.includes('duplicate')) {
            console.warn('[adminCreatePartnerCompanyDirect] invite:', inviteError.message);
        } else {
            ownerInvite = {
                linked_immediately: false,
                message: 'Convite registrado. O gestor deve entrar com este e-mail.',
            };
        }
    }

    return {
        success: true,
        company_id: companyId,
        owner_invite: ownerInvite,
        usedFallback: true as const,
    };
}

export async function acceptCompanyMemberInvites(): Promise<number> {
    const { data, error } = await supabase.rpc('accept_company_member_invites');
    if (error) throw error;
    return Number((data as { accepted?: number })?.accepted ?? 0);
}

export async function inviteCompanyMember(
    companyId: string,
    email: string,
    role: CompanyMemberRole = 'pdv_operator',
) {
    const { data, error } = await supabase.rpc('invite_company_member', {
        p_company_id: companyId,
        p_email: email.trim().toLowerCase(),
        p_role: role,
    });
    if (error) throw error;
    return data as {
        ok: boolean;
        linked_immediately?: boolean;
        invite_id?: string;
        message?: string;
    };
}

export async function listCompanyMembers(companyId: string) {
    const { data, error } = await supabase.rpc('list_company_members', {
        p_company_id: companyId,
    });
    if (error) throw error;
    const payload = data as {
        members?: CompanyMemberRow[];
        pending_invites?: PendingCompanyInvite[];
    };
    return {
        members: payload.members ?? [],
        pendingInvites: payload.pending_invites ?? [],
    };
}

export async function adminCreatePartnerCompany(input: {
    cnpj: string;
    corporateName: string;
    tradeName?: string;
    email?: string;
    phone?: string;
    ownerEmail?: string;
}) {
    const rpcArgs = {
        p_cnpj: input.cnpj,
        p_corporate_name: input.corporateName,
        p_trade_name: input.tradeName ?? null,
        p_email: input.email ?? null,
        p_phone: input.phone ?? null,
        p_owner_email: input.ownerEmail ?? input.email ?? null,
    };

    let data: {
        success: boolean;
        company_id: string;
        owner_invite?: { linked_immediately?: boolean; message?: string };
        usedFallback?: boolean;
    };

    try {
        data = await callRpc<typeof data>('admin_create_partner_company', rpcArgs, 8_000);
    } catch (err) {
        const useFallback =
            err instanceof RpcTimeoutError ||
            (err instanceof Error &&
                (/does not exist/i.test(err.message) ||
                    /permission denied/i.test(err.message) ||
                    /42501/.test(err.message)));

        if (useFallback) {
            console.warn('[adminCreatePartnerCompany] RPC indisponível — insert direto (admin).', err);
            data = await adminCreatePartnerCompanyDirect(input);
        } else {
            throw err;
        }
    }

    return { ...data, warnings: [] as string[] };
}

/** E-mail do convite pendente de dono (gestor) da empresa parceira. */
export async function fetchPartnerOwnerInviteEmail(companyId: string): Promise<string | null> {
    const { data: pendingInvite, error: inviteError } = await supabase
        .from('company_member_invites')
        .select('email')
        .eq('company_id', companyId)
        .eq('role', 'owner')
        .is('accepted_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (inviteError) {
        console.warn('[fetchPartnerOwnerInviteEmail]', inviteError.message);
    }
    if (pendingInvite?.email) {
        return pendingInvite.email.trim().toLowerCase();
    }

    const { data: membersData, error: membersError } = await supabase.rpc('list_company_members', {
        p_company_id: companyId,
    });
    if (membersError) {
        console.warn('[fetchPartnerOwnerInviteEmail] list_company_members:', membersError.message);
        return null;
    }

    const members = (membersData as { members?: CompanyMemberRow[] })?.members ?? [];
    const owner = members.find((m) => m.role === 'owner' && m.email);
    return owner?.email?.trim().toLowerCase() ?? null;
}

export async function adminDeletePartnerCompany(companyId: string): Promise<void> {
    const { data, error } = await supabase.rpc('admin_delete_partner_company', {
        p_company_id: companyId,
    });
    if (error) throw error;
    const payload = data as { ok?: boolean } | null;
    if (!payload?.ok) {
        throw new Error('Não foi possível excluir a empresa parceira.');
    }
}

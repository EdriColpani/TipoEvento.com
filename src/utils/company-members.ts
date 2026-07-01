import { supabase } from '@/integrations/supabase/client';
import type { CompanyMemberRole } from '@/constants/company-roles';

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
    const { data, error } = await supabase.rpc('admin_create_partner_company', {
        p_cnpj: input.cnpj,
        p_corporate_name: input.corporateName,
        p_trade_name: input.tradeName ?? null,
        p_email: input.email ?? null,
        p_phone: input.phone ?? null,
        p_owner_email: input.ownerEmail ?? input.email ?? null,
    });
    if (error) throw error;
    return data as {
        success: boolean;
        company_id: string;
        owner_invite?: { linked_immediately?: boolean; message?: string };
    };
}

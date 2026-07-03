import { supabase, supabaseUrl, supabaseAnonKey } from '@/integrations/supabase/client';
import type { CompanyMemberRole } from '@/constants/company-roles';
import { RpcTimeoutError } from '@/utils/supabase-rpc';
import { callRpcRest } from '@/utils/supabase-rest-rpc';
import { withTimeout } from '@/utils/promise-timeout';

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

export type PartnerCompanyAddress = {
    cep: string;
    street: string;
    number: string;
    complement?: string;
    neighborhood: string;
    city: string;
    state: string;
};

function normalizeCnpj(raw: string): string {
    return raw.replace(/\D/g, '');
}

function normalizePhone(raw: string | undefined): string | null {
    const digits = (raw ?? '').replace(/\D/g, '');
    return digits || null;
}

function normalizeCep(raw: string): string {
    return raw.replace(/\D/g, '');
}

function readCachedAccessToken(): string | null {
    try {
        const ref = new URL(supabaseUrl).hostname.split('.')[0];
        const raw = localStorage.getItem(`sb-${ref}-auth-token`);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { access_token?: string };
        return parsed.access_token ?? null;
    } catch {
        return null;
    }
}

async function restInsertPartnerCompany(
    payload: Record<string, unknown>,
): Promise<{ id: string }> {
    const token = readCachedAccessToken();
    if (!token) {
        throw new Error('Sessão expirada. Faça login novamente.');
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 10_000);

    try {
        const response = await fetch(`${supabaseUrl}/rest/v1/companies?select=id`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                apikey: supabaseAnonKey,
                Authorization: `Bearer ${token}`,
                Prefer: 'return=representation',
            },
            body: JSON.stringify(payload),
        });

        const data = (await response.json().catch(() => null)) as
            | { id?: string; message?: string; code?: string }[]
            | { id?: string; message?: string; code?: string }
            | null;

        if (!response.ok) {
            const row = Array.isArray(data) ? data[0] : data;
            const message = row?.message ?? 'Erro ao gravar empresa.';
            if (row?.code === '23505' || message.includes('duplicate')) {
                throw new Error('CNPJ já cadastrado.');
            }
            throw new Error(message);
        }

        const row = Array.isArray(data) ? data[0] : data;
        if (!row?.id) {
            throw new Error('Empresa criada, mas o ID não foi retornado.');
        }
        return { id: row.id };
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new Error('Tempo esgotado ao gravar a empresa. Tente novamente.');
        }
        throw error;
    } finally {
        window.clearTimeout(timer);
    }
}

async function adminCreatePartnerCompanyDirect(input: {
    cnpj: string;
    corporateName: string;
    tradeName?: string;
    email?: string;
    phone?: string;
    ownerEmail?: string;
    address: PartnerCompanyAddress;
}) {
    const cnpj = normalizeCnpj(input.cnpj);
    if (cnpj.length !== 14) {
        throw new Error('CNPJ inválido.');
    }

    const cep = normalizeCep(input.address.cep);
    if (cep.length !== 8) {
        throw new Error('CEP inválido (8 dígitos).');
    }

    const company = await restInsertPartnerCompany({
        cnpj,
        corporate_name: input.corporateName.trim(),
        trade_name: input.tradeName?.trim() || null,
        email: input.email?.trim() || null,
        phone: normalizePhone(input.phone),
        cep,
        street: input.address.street.trim(),
        number: input.address.number.trim(),
        complement: input.address.complement?.trim() || null,
        neighborhood: input.address.neighborhood.trim(),
        city: input.address.city.trim(),
        state: input.address.state.trim().toUpperCase(),
        company_kind: 'partner',
        billing_plan: 'consumption_or_license',
        requires_billing_reacceptance: true,
    });

    const companyId = company.id;
    const ownerEmail = (input.ownerEmail || input.email || '').trim().toLowerCase();
    let ownerInvite: { linked_immediately?: boolean; message?: string } | undefined;

    if (ownerEmail && ownerEmail.includes('@')) {
        const token = readCachedAccessToken();
        if (token) {
            const controller = new AbortController();
            const timer = window.setTimeout(() => controller.abort(), 5_000);
            try {
                await fetch(`${supabaseUrl}/rest/v1/company_member_invites`, {
                    method: 'POST',
                    signal: controller.signal,
                    headers: {
                        'Content-Type': 'application/json',
                        apikey: supabaseAnonKey,
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        company_id: companyId,
                        email: ownerEmail,
                        role: 'owner',
                    }),
                });
                ownerInvite = {
                    linked_immediately: false,
                    message: 'Convite registrado. O gestor deve entrar com este e-mail.',
                };
            } catch {
                console.warn('[adminCreatePartnerCompanyDirect] invite insert timeout');
            } finally {
                window.clearTimeout(timer);
            }
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
    address: PartnerCompanyAddress;
}) {
    const rpcArgs = {
        p_cnpj: input.cnpj,
        p_corporate_name: input.corporateName,
        p_trade_name: input.tradeName ?? null,
        p_email: input.email ?? null,
        p_phone: input.phone ?? null,
        p_owner_email: input.ownerEmail ?? input.email ?? null,
        p_cep: normalizeCep(input.address.cep),
        p_street: input.address.street.trim(),
        p_number: input.address.number.trim(),
        p_complement: input.address.complement?.trim() || null,
        p_neighborhood: input.address.neighborhood.trim(),
        p_city: input.address.city.trim(),
        p_state: input.address.state.trim().toUpperCase(),
    };

    try {
        const data = await callRpcRest<{
            success: boolean;
            company_id: string;
            owner_invite?: { linked_immediately?: boolean; message?: string };
        }>('admin_create_partner_company', rpcArgs, 12_000);

        return { ...data, warnings: [] as string[] };
    } catch (rpcErr) {
        if (rpcErr instanceof RpcTimeoutError) {
            console.warn('[adminCreatePartnerCompany] RPC timeout — tentando REST insert.');
        } else {
            const msg = rpcErr instanceof Error ? rpcErr.message : String(rpcErr);
            if (
                msg.includes('CNPJ já cadastrado') ||
                msg.includes('CNPJ inválido') ||
                msg.includes('razão social') ||
                msg.includes('CEP') ||
                msg.includes('logradouro') ||
                msg.includes('número') ||
                msg.includes('bairro') ||
                msg.includes('cidade') ||
                msg.includes('UF') ||
                msg.includes('Admin Master')
            ) {
                throw rpcErr;
            }
            console.warn('[adminCreatePartnerCompany] RPC falhou — tentando REST insert.', rpcErr);
        }
    }

    const direct = await adminCreatePartnerCompanyDirect(input);
    return { ...direct, warnings: [] as string[] };
}

export async function fetchPartnerOwnerInviteEmail(companyId: string): Promise<string | null> {
    const { data: pendingInvite, error: inviteError } = await withTimeout(
        supabase
            .from('company_member_invites')
            .select('email')
            .eq('company_id', companyId)
            .eq('role', 'owner')
            .is('accepted_at', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        5_000,
        { data: null, error: { message: 'timeout' } },
    );

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

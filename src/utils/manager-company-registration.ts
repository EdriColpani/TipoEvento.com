import type { QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { CompanyFormData } from '@/components/CompanyForm';
import type { CompanyKind } from '@/constants/company-kind';
import { clearManagerRegistrationUseCase } from '@/constants/company-kind';

export const MANAGER_COMPANY_REGISTER_DRAFT_KEY = 'eventfest_manager_company_register_draft';
export const MANAGER_COMPANY_REGISTER_PATH = '/manager/register/company';
export const PENDING_PROMOTER_METADATA_KEY = 'pending_promoter_registration';

export type CompanyRegisterDraft = {
    company: CompanyFormData;
    accountName: string;
    autoFinalize?: boolean;
    savedAt: number;
};

export function saveCompanyRegisterDraft(draft: Omit<CompanyRegisterDraft, 'savedAt'>) {
    sessionStorage.setItem(
        MANAGER_COMPANY_REGISTER_DRAFT_KEY,
        JSON.stringify({ ...draft, savedAt: Date.now() }),
    );
}

export function loadCompanyRegisterDraft(): CompanyRegisterDraft | null {
    try {
        const raw = sessionStorage.getItem(MANAGER_COMPANY_REGISTER_DRAFT_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as CompanyRegisterDraft;
        if (!parsed.company || typeof parsed.accountName !== 'string') return null;
        return parsed;
    } catch {
        return null;
    }
}

export function clearCompanyRegisterDraft() {
    sessionStorage.removeItem(MANAGER_COMPANY_REGISTER_DRAFT_KEY);
}

export function hasPendingPromoterRegistration(user: {
    user_metadata?: Record<string, unknown>;
} | null | undefined): boolean {
    return user?.user_metadata?.[PENDING_PROMOTER_METADATA_KEY] === true;
}

export async function clearPendingPromoterMetadata(): Promise<void> {
    await supabase.auth.updateUser({
        data: { [PENDING_PROMOTER_METADATA_KEY]: false },
    });
}

export async function finalizeManagerCompanyRegistration(
    activeUserId: string,
    values: CompanyFormData,
    queryClient?: QueryClient,
    companyKind: CompanyKind = 'organizer',
): Promise<string> {
    const dataToSave = {
        cnpj: values.cnpj.replace(/\D/g, ''),
        corporate_name: values.corporate_name,
        trade_name: values.trade_name || null,
        phone: values.phone ? values.phone.replace(/\D/g, '') : null,
        email: values.email || null,
        cep: values.cep ? values.cep.replace(/\D/g, '') : null,
        street: values.street || null,
        number: values.number || null,
        neighborhood: values.neighborhood || null,
        city: values.city || null,
        state: values.state || null,
        complement: values.complement || null,
        company_kind: companyKind,
    };

    const { error: profileUpdateError } = await supabase
        .from('profiles')
        .update({
            tipo_usuario_id: 2,
            natureza_juridica_id: 2,
        })
        .eq('id', activeUserId);

    if (profileUpdateError) {
        throw new Error(
            profileUpdateError.message ||
                'Não foi possível atualizar o perfil para gestor. Verifique permissões (RLS) ou tente de novo.',
        );
    }

    const { data: companyData, error: companyError } = await supabase
        .from('companies')
        .insert([dataToSave])
        .select('id')
        .single();

    if (companyError) {
        if (companyError.code === '23505' && companyError.message.includes('cnpj')) {
            throw new Error('Este CNPJ já está cadastrado em outra conta.');
        }
        throw companyError;
    }

    const companyId = companyData.id;

    const { error: associationError } = await supabase.from('user_companies').insert({
        user_id: activeUserId,
        company_id: companyId,
        role: 'owner',
        is_primary: true,
    });

    if (associationError) {
        await supabase.from('companies').delete().eq('id', companyId);
        throw new Error(
            associationError.message ||
                'Empresa criada, mas falhou o vínculo com sua conta. Tente novamente ou contate o suporte.',
        );
    }

    const { error: eventUpdateError } = await supabase
        .from('events')
        .update({ status: 'approved' })
        .eq('company_id', companyId)
        .eq('status', 'pending');

    if (eventUpdateError) {
        console.error('Warning: Failed to update event statuses to approved:', eventUpdateError);
    }

    await clearPendingPromoterMetadata();
    clearCompanyRegisterDraft();
    clearManagerRegistrationUseCase();

    if (queryClient) {
        queryClient.invalidateQueries({ queryKey: ['managerCompany', activeUserId] });
        queryClient.invalidateQueries({ queryKey: ['profile', activeUserId] });
        queryClient.invalidateQueries({ queryKey: ['dashboardData'] });
    }

    return companyId;
}

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchManagerPrimaryCompanyId } from '@/utils/manager-scope';
import type { CompanyKind } from '@/constants/company-kind';
import type { CompanyMemberRole } from '@/constants/company-roles';

export interface ManagerCompanyContext {
    companyId: string | null;
    companyKind: CompanyKind;
    memberRole: CompanyMemberRole;
    isPartnerCompany: boolean;
    isPdvOperator: boolean;
    isCompanyOwner: boolean;
}

async function fetchManagerCompanyContext(userId: string): Promise<ManagerCompanyContext> {
    const companyId = await fetchManagerPrimaryCompanyId(supabase, userId);
    if (!companyId) {
        return {
            companyId: null,
            companyKind: 'organizer',
            memberRole: 'owner',
            isPartnerCompany: false,
            isPdvOperator: false,
            isCompanyOwner: true,
        };
    }

    const [{ data: companyRow }, { data: linkRow }] = await Promise.all([
        supabase.from('companies').select('company_kind').eq('id', companyId).maybeSingle(),
        supabase
            .from('user_companies')
            .select('role')
            .eq('user_id', userId)
            .eq('company_id', companyId)
            .maybeSingle(),
    ]);

    const companyKind = (companyRow?.company_kind as CompanyKind | undefined) ?? 'organizer';
    const memberRole = (linkRow?.role as CompanyMemberRole | undefined) ?? 'owner';

    return {
        companyId,
        companyKind,
        memberRole,
        isPartnerCompany: companyKind === 'partner',
        isPdvOperator: memberRole === 'pdv_operator',
        isCompanyOwner: memberRole === 'owner',
    };
}

export function useManagerCompanyContext(userId: string | undefined) {
    const query = useQuery({
        queryKey: ['managerCompanyContext', userId],
        queryFn: () => fetchManagerCompanyContext(userId!),
        enabled: Boolean(userId),
        staleTime: 60_000,
    });

    return {
        ...query,
        context: query.data,
    };
}

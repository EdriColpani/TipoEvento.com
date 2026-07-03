import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchManagerPrimaryCompanyId, fetchManagerPrimaryCompanyIdRest } from '@/utils/manager-scope';
import type { CompanyKind } from '@/constants/company-kind';
import type { CompanyMemberRole } from '@/constants/company-roles';
import { restGet } from '@/utils/supabase-rest';
import { withTimeout } from '@/utils/promise-timeout';

export interface ManagerCompanyContext {
    companyId: string | null;
    companyKind: CompanyKind;
    memberRole: CompanyMemberRole;
    isPartnerCompany: boolean;
    isPdvOperator: boolean;
    isCompanyOwner: boolean;
}

async function fetchManagerCompanyContext(userId: string): Promise<ManagerCompanyContext> {
    let companyId: string | null = null;
    try {
        companyId = await fetchManagerPrimaryCompanyIdRest(userId);
    } catch {
        /* fallback */
    }
    if (!companyId) {
        companyId = await withTimeout(fetchManagerPrimaryCompanyId(supabase, userId), 8_000, null);
    }

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

    let companyKind: CompanyKind = 'organizer';
    let memberRole: CompanyMemberRole = 'owner';

    try {
        const [companyRows, linkRows] = await Promise.all([
            restGet<{ company_kind: CompanyKind }[]>(
                `companies?id=eq.${companyId}&select=company_kind&limit=1`,
                6_000,
            ),
            restGet<{ role: CompanyMemberRole }[]>(
                `user_companies?user_id=eq.${userId}&company_id=eq.${companyId}&select=role&limit=1`,
                6_000,
            ),
        ]);
        companyKind = companyRows?.[0]?.company_kind ?? 'organizer';
        memberRole = linkRows?.[0]?.role ?? 'owner';
    } catch (restError) {
        console.warn('[useManagerCompanyContext] REST falhou:', restError);
        const [{ data: companyRow }, { data: linkRow }] = await withTimeout(
            Promise.all([
                supabase.from('companies').select('company_kind').eq('id', companyId).maybeSingle(),
                supabase
                    .from('user_companies')
                    .select('role')
                    .eq('user_id', userId)
                    .eq('company_id', companyId)
                    .maybeSingle(),
            ]),
            8_000,
            [{ data: null }, { data: null }],
        );
        companyKind = (companyRow?.company_kind as CompanyKind | undefined) ?? 'organizer';
        memberRole = (linkRow?.role as CompanyMemberRole | undefined) ?? 'owner';
    }

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

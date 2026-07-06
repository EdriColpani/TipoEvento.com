import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchManagerPrimaryCompanyId, fetchManagerPrimaryCompanyIdRest } from '@/utils/manager-scope';
import { restGet } from '@/utils/supabase-rest';
import { withTimeout } from '@/utils/promise-timeout';

interface CompanyData {
    id: string;
    cnpj: string;
    corporate_name: string;
}

const fetchCompanyId = async (userId: string): Promise<CompanyData | null> => {
    if (!userId) return null;

    let companyId: string | null = null;
    try {
        companyId = await fetchManagerPrimaryCompanyIdRest(userId);
    } catch (restLinkError) {
        console.warn('[useManagerCompany] REST user_companies falhou:', restLinkError);
    }

    if (!companyId) {
        companyId = await withTimeout(fetchManagerPrimaryCompanyId(supabase, userId), 8_000, null);
    }
    if (!companyId) return null;

    try {
        const rows = await restGet<CompanyData[]>(
            `companies?id=eq.${companyId}&select=id,cnpj,corporate_name&limit=1`,
            8_000,
        );
        if (rows[0]) return rows[0];
    } catch (restCompanyError) {
        console.warn('[useManagerCompany] REST companies falhou:', restCompanyError);
    }

    const { data: companyRow, error: companyError } = await withTimeout(
        supabase.from('companies').select('id, cnpj, corporate_name').eq('id', companyId).maybeSingle(),
        8_000,
        { data: null, error: { message: 'timeout' } as { message: string } },
    );

    if (companyError && companyError.message !== 'timeout' && companyError.code !== 'PGRST116') {
        console.warn('Error fetching companies row for manager:', companyError);
    }

    if (!companyRow) {
        return { id: companyId, cnpj: '', corporate_name: '' };
    }

    return companyRow as CompanyData;
};

export const useManagerCompany = (userId: string | undefined) => {
    const query = useQuery({
        queryKey: ['managerCompany', userId],
        queryFn: () => withTimeout(fetchCompanyId(userId!), 15_000, null),
        enabled: !!userId,
        staleTime: 1000 * 60 * 5,
        retry: 1,
    });

    return {
        ...query,
        company: query.data,
        isLoading: query.isLoading,
    };
};

export type { CompanyData };

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchManagerPrimaryCompanyId } from '@/utils/manager-scope';

interface CompanyData {
    id: string;
    cnpj: string;
    corporate_name: string;
}

const fetchCompanyId = async (userId: string): Promise<CompanyData | null> => {
    if (!userId) return null;

    const companyId = await fetchManagerPrimaryCompanyId(supabase, userId);
    if (!companyId) {
        return null;
    }

    // Query direta em `companies` evita embed/join que em alguns ambientes retorna 406 ou objeto vazio por RLS.
    const { data: companyRow, error: companyError } = await supabase
        .from('companies')
        .select('id, cnpj, corporate_name')
        .eq('id', companyId)
        .maybeSingle();

    if (companyError && companyError.code !== 'PGRST116') {
        console.warn('Error fetching companies row for manager:', companyError);
        return null;
    }

    if (!companyRow) {
        // Vínculo existe em user_companies mas a linha em companies não veio (RLS/embed). Ainda assim o UUID é válido para FK em events.
        console.warn(
            '[useManagerCompany] company_id resolvido sem leitura da linha em companies; usando id apenas.',
        );
        return { id: companyId, cnpj: '', corporate_name: '' };
    }

    return companyRow as CompanyData;
};

export const useManagerCompany = (userId: string | undefined) => {
    const query = useQuery({
        queryKey: ['managerCompany', userId],
        queryFn: () => fetchCompanyId(userId!),
        enabled: !!userId,
        staleTime: 1000 * 60 * 5,
        retry: 1,
    });

    return {
        ...query,
        company: query.data,
    };
};

export type { CompanyData };
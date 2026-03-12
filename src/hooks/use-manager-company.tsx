import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { showError } from '@/utils/toast';

interface CompanyData {
    id: string;
    cnpj: string;
    corporate_name: string;
}

const fetchCompanyId = async (userId: string): Promise<CompanyData | null> => {
    if (!userId) return null;

    // Busca a empresa associada ao usuário logado através da tabela user_companies
    // Assumimos que o gestor PRO (tipo 2) está associado a uma empresa principal (is_primary = true)
    // Especificando o relacionamento explícito via company_id para evitar erro PGRST201
    const { data, error } = await supabase
        .from('user_companies')
        .select(`
            company_id,
            companies!company_id (id, cnpj, corporate_name)
        `)
        .eq('user_id', userId)
        .eq('is_primary', true) // Foca na empresa principal do gestor
        .limit(1)
        .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = No rows found
        console.error("Error fetching company ID via user_companies:", error);
        throw new Error(error.message);
    }
    
    if (data && data.companies) {
        return data.companies as CompanyData;
    }
    
    return null;
};

export const useManagerCompany = (userId: string | undefined) => {
    const query = useQuery({
        queryKey: ['managerCompany', userId],
        queryFn: () => fetchCompanyId(userId!),
        enabled: !!userId,
        staleTime: 1000 * 60 * 5, // 5 minutes
        onError: (error) => {
            console.error("Query Error: Failed to load company data.", error);
            // Removido o toast de erro aqui, pois a ausência de empresa é um estado esperado para PF
        }
    });

    return {
        ...query,
        company: query.data,
    };
};

export type { CompanyData };
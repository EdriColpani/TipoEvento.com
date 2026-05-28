import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { parseEdgeFunctionError } from '@/utils/edge-function-error';

export type CreditMenuProduct = {
    id: string;
    name: string;
    description: string | null;
    unitPrice: number;
};

export type CreditMenuPayload = {
    establishment: {
        id: string;
        name: string;
        companyName: string;
        eventTitle: string | null;
    };
    products: CreditMenuProduct[];
};

export type CreditMenuTokenIssue = {
    token: string;
    expiresAt: string;
    ttlSeconds: number;
};

export async function issueCreditMenuToken(establishmentId: string): Promise<CreditMenuTokenIssue> {
    const { data, error } = await supabase.functions.invoke('issue-credit-menu-token', {
        body: { establishmentId },
    });
    if (error) throw new Error(await parseEdgeFunctionError(error, data));
    if (!data?.token) throw new Error('Não foi possível gerar o QR do balcão.');
    return data as CreditMenuTokenIssue;
}

async function resolveCreditMenu(menuToken: string): Promise<CreditMenuPayload> {
    const { data, error } = await supabase.functions.invoke('resolve-credit-menu-token', {
        body: { menuToken },
    });
    if (error) throw new Error(await parseEdgeFunctionError(error, data));
    return {
        establishment: data.establishment,
        products: data.products ?? [],
    } as CreditMenuPayload;
}

export function useCreditMenu(menuToken: string | null | undefined) {
    return useQuery({
        queryKey: ['creditMenu', menuToken],
        queryFn: () => resolveCreditMenu(menuToken!),
        enabled: !!menuToken,
        staleTime: 30_000,
        retry: 1,
    });
}

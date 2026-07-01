export type CompanyMemberRole = 'owner' | 'pdv_operator';

export const COMPANY_ROLE_LABELS: Record<CompanyMemberRole, string> = {
    owner: 'Proprietário',
    pdv_operator: 'Operador PDV',
};

export function isPdvOperatorRole(role: string | null | undefined): boolean {
    return role === 'pdv_operator';
}

export function isCompanyOwnerRole(role: string | null | undefined): boolean {
    return !role || role === 'owner';
}

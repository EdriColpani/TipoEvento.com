export type CompanyKind = 'organizer' | 'partner';

export const COMPANY_KIND_LABELS: Record<CompanyKind, string> = {
    organizer: 'Organizador de eventos',
    partner: 'Empresa parceira (consumo)',
};

export const MANAGER_REGISTRATION_USE_CASE_KEY = 'eventfest_manager_registration_use_case';

export type ManagerRegistrationUseCase = 'organizer' | 'partner';

export function loadManagerRegistrationUseCase(): ManagerRegistrationUseCase {
    try {
        const raw = sessionStorage.getItem(MANAGER_REGISTRATION_USE_CASE_KEY);
        return raw === 'partner' ? 'partner' : 'organizer';
    } catch {
        return 'organizer';
    }
}

export function saveManagerRegistrationUseCase(useCase: ManagerRegistrationUseCase) {
    sessionStorage.setItem(MANAGER_REGISTRATION_USE_CASE_KEY, useCase);
}

export function clearManagerRegistrationUseCase() {
    sessionStorage.removeItem(MANAGER_REGISTRATION_USE_CASE_KEY);
}

export function companyKindFromUseCase(useCase: ManagerRegistrationUseCase): CompanyKind {
    return useCase === 'partner' ? 'partner' : 'organizer';
}

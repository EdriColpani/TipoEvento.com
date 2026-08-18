export const MANAGER_INDIVIDUAL_REGISTER_PATH = '/manager/register/individual';
export const MANAGER_REGISTRATION_KIND_KEY = 'eventfest_manager_registration_kind';
export const MANAGER_REGISTRATION_KIND_METADATA_KEY = 'manager_registration_kind';

export type ManagerRegistrationKind = 'individual' | 'company';

export function saveManagerRegistrationKind(kind: ManagerRegistrationKind) {
    try {
        sessionStorage.setItem(MANAGER_REGISTRATION_KIND_KEY, kind);
    } catch {
        /* ignore */
    }
}

export function loadManagerRegistrationKind(): ManagerRegistrationKind | null {
    try {
        const raw = sessionStorage.getItem(MANAGER_REGISTRATION_KIND_KEY);
        if (raw === 'individual' || raw === 'company') return raw;
        return null;
    } catch {
        return null;
    }
}

export function clearManagerRegistrationKind() {
    try {
        sessionStorage.removeItem(MANAGER_REGISTRATION_KIND_KEY);
    } catch {
        /* ignore */
    }
}

function kindFromUnknown(value: unknown): ManagerRegistrationKind | null {
    return value === 'individual' || value === 'company' ? value : null;
}

export function managerRegistrationKindFromUser(user: {
    user_metadata?: Record<string, unknown>;
} | null | undefined): ManagerRegistrationKind | null {
    return kindFromUnknown(user?.user_metadata?.[MANAGER_REGISTRATION_KIND_METADATA_KEY]);
}

export function resolveManagerOnboardingPath(
    user?: { user_metadata?: Record<string, unknown> } | null,
): string {
    const kind =
        managerRegistrationKindFromUser(user) ?? loadManagerRegistrationKind() ?? 'company';
    return kind === 'individual'
        ? MANAGER_INDIVIDUAL_REGISTER_PATH
        : '/manager/register/company';
}

import type { User } from '@supabase/supabase-js';

/** Conta só pode concluir cadastro / login pleno após e-mail confirmado no Auth. */
export function isAuthEmailConfirmed(user: User | null | undefined): boolean {
    if (!user?.email) return false;
    if (user.email_confirmed_at) return true;

    const confirmedAt = (user as User & { confirmed_at?: string | null }).confirmed_at;
    if (confirmedAt) return true;

    const emailIdentity = user.identities?.find(
        (identity) => identity.provider === 'email' || identity.provider === 'google',
    );
    if (emailIdentity?.identity_data?.email_verified === true) return true;

    return false;
}

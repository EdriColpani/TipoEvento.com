import type { User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export const PASSWORD_SETUP_REQUIRED_KEY = 'password_setup_required';
export const INVITED_PARTNER_OWNER_KEY = 'invited_partner_owner';

export const RESET_PASSWORD_PATH = '/reset-password';

/** Gestor parceiro convidado ainda precisa definir senha (metadata local). */
export function userNeedsPasswordSetup(user: User | null | undefined): boolean {
    if (!user) return false;
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    return meta[PASSWORD_SETUP_REQUIRED_KEY] === true;
}

export function isPartnerOwnerInviteCallback(): boolean {
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    return (
        hash.includes('type=invite') ||
        hash.includes('type=recovery') ||
        hash.includes('type=magiclink')
    );
}

/** Inclui convite owner pendente no banco (ex.: entrou por magiclink antigo). */
export async function userMustSetPartnerPassword(user: User | null | undefined): Promise<boolean> {
    if (userNeedsPasswordSetup(user)) return true;
    if (!user?.id) return false;

    const { data, error } = await supabase.rpc('user_must_set_partner_password');
    if (error) {
        console.warn('[userMustSetPartnerPassword]', error.message);
        return false;
    }
    return Boolean(data);
}

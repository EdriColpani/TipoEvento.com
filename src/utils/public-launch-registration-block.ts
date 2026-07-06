import { supabase } from '@/integrations/supabase/client';
import { readCachedAuthSession } from '@/utils/auth-session-cache';
import {
    canBypassPublicLaunchPreview,
    normalizePublicLaunchMode,
} from '@/utils/public-launch-access';

/** Verifica se cadastros devem ficar bloqueados no modo pré-lançamento. */
export async function isRegistrationBlockedByPreview(): Promise<boolean> {
    const { data, error } = await supabase.rpc('get_public_launch_mode');
    if (error) {
        if (error.message?.includes('function') || error.code === '42883') {
            return false;
        }
        return true;
    }

    if (normalizePublicLaunchMode(data) !== 'preview') {
        return false;
    }

    const { userId } = readCachedAuthSession();

    if (!userId) {
        return true;
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('tipo_usuario_id')
        .eq('id', userId)
        .maybeSingle();

    return !canBypassPublicLaunchPreview(profile?.tipo_usuario_id);
}

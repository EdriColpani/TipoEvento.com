import { supabase } from '@/integrations/supabase/client';
import {
    canBypassPublicLaunchPreview,
    normalizePublicLaunchMode,
} from '@/utils/public-launch-access';

/** Verifica se cadastros devem ficar bloqueados no modo pré-lançamento. */
export async function isRegistrationBlockedByPreview(): Promise<boolean> {
    const { data, error } = await supabase.rpc('get_public_launch_mode');
    if (error) return false;

    if (normalizePublicLaunchMode(data) !== 'preview') {
        return false;
    }

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return true;
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('tipo_usuario_id')
        .eq('id', user.id)
        .maybeSingle();

    return !canBypassPublicLaunchPreview(profile?.tipo_usuario_id);
}

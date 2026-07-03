import { supabase } from '@/integrations/supabase/client';
import { normalizePublicLaunchMode, type PublicLaunchMode } from '@/utils/public-launch-access';

export const PUBLIC_LAUNCH_MODE_QUERY_KEY = ['publicLaunchMode'] as const;

export async function fetchPublicLaunchMode(): Promise<PublicLaunchMode> {
    try {
        const { data, error } = await supabase.rpc('get_public_launch_mode');
        if (error) {
            if (error.message?.includes('function') || error.code === '42883') {
                return 'live';
            }
            console.warn('get_public_launch_mode:', error.message);
            return 'preview';
        }
        return normalizePublicLaunchMode(data);
    } catch (e) {
        console.warn('get_public_launch_mode failed', e);
        return 'preview';
    }
}

import { supabaseAnonKey, supabaseUrl } from '@/integrations/supabase/client';
import { normalizePublicLaunchMode, type PublicLaunchMode } from '@/utils/public-launch-access';
import { withTimeout } from '@/utils/promise-timeout';

export const PUBLIC_LAUNCH_MODE_QUERY_KEY = ['publicLaunchMode'] as const;

async function fetchPublicLaunchModeRest(timeoutMs = 8_000): Promise<PublicLaunchMode> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${supabaseUrl}/rest/v1/rpc/get_public_launch_mode`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                apikey: supabaseAnonKey,
                Authorization: `Bearer ${supabaseAnonKey}`,
            },
            body: '{}',
        });

        const data = (await response.json().catch(() => null)) as string | { message?: string } | null;

        if (!response.ok) {
            const message = data && typeof data === 'object' && data.message ? data.message : '';
            if (message.includes('function') || response.status === 404) {
                return 'live';
            }
            console.warn('get_public_launch_mode REST:', message || response.status);
            return 'preview';
        }

        return normalizePublicLaunchMode(typeof data === 'string' ? data : data);
    } catch (e) {
        const aborted = e instanceof DOMException && e.name === 'AbortError';
        console.warn('get_public_launch_mode failed', aborted ? 'timeout' : e);
        return 'preview';
    } finally {
        window.clearTimeout(timer);
    }
}

export async function fetchPublicLaunchMode(): Promise<PublicLaunchMode> {
    return withTimeout(fetchPublicLaunchModeRest(), 10_000, 'preview' as PublicLaunchMode);
}

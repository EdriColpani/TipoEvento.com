import { usePublicLaunchModeContext } from '@/contexts/PublicLaunchModeContext';

export const PUBLIC_LAUNCH_MODE_QUERY_KEY = ['publicLaunchMode'] as const;

/** Pré-lançamento desativado — sempre modo live. */
export async function fetchPublicLaunchMode(): Promise<'live'> {
    return 'live';
}

export function usePublicLaunchMode() {
    return usePublicLaunchModeContext();
}

export function useInvalidatePublicLaunchMode() {
    return () => undefined;
}

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/hooks/use-profile';
import {
    canBypassPublicLaunchPreview,
    normalizePublicLaunchMode,
    type PublicLaunchMode,
} from '@/utils/public-launch-access';

export const PUBLIC_LAUNCH_MODE_QUERY_KEY = ['publicLaunchMode'] as const;

async function fetchPublicLaunchMode(): Promise<PublicLaunchMode> {
    try {
        const { data, error } = await supabase.rpc('get_public_launch_mode');
        if (error) {
            if (error.message?.includes('function') || error.code === '42883') {
                return 'live';
            }
            console.warn('get_public_launch_mode:', error.message);
            return 'live';
        }
        return normalizePublicLaunchMode(data);
    } catch (e) {
        console.warn('get_public_launch_mode failed', e);
        return 'live';
    }
}

export function usePublicLaunchMode() {
    const [userId, setUserId] = useState<string | undefined>(undefined);
    const [authReady, setAuthReady] = useState(false);
    const { profile, isLoading: isLoadingProfile } = useProfile(userId);

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
            setUserId(user?.id);
            setAuthReady(true);
        });
    }, []);

    const query = useQuery({
        queryKey: [...PUBLIC_LAUNCH_MODE_QUERY_KEY],
        queryFn: fetchPublicLaunchMode,
        staleTime: 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
    });

    const mode = query.data ?? 'live';
    const canBypassPreview = canBypassPublicLaunchPreview(profile?.tipo_usuario_id);
    const isPreview = mode === 'preview';
    const awaitingStaffProfile = isPreview && authReady && Boolean(userId) && isLoadingProfile;
    const showPreLaunchExperience = isPreview && !canBypassPreview && !awaitingStaffProfile;

    return {
        mode,
        isPreview,
        canBypassPreview,
        showPreLaunchExperience,
        isLoading: false,
        isError: query.isError,
    };
}

export function useInvalidatePublicLaunchMode() {
    const queryClient = useQueryClient();
    return () => queryClient.invalidateQueries({ queryKey: [...PUBLIC_LAUNCH_MODE_QUERY_KEY] });
}

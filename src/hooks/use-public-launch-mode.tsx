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
    const { data, error } = await supabase.rpc('get_public_launch_mode');
    if (error) {
        if (error.message?.includes('function') || error.code === '42883') {
            return 'live';
        }
        throw new Error(error.message);
    }
    return normalizePublicLaunchMode(data);
}

export function usePublicLaunchMode() {
    const [userId, setUserId] = useState<string | undefined>(undefined);
    const { profile } = useProfile(userId);

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
            setUserId(user?.id);
        });
    }, []);

    const query = useQuery({
        queryKey: [...PUBLIC_LAUNCH_MODE_QUERY_KEY],
        queryFn: fetchPublicLaunchMode,
        staleTime: 60_000,
    });

    const mode = query.data ?? 'live';
    const canBypassPreview = canBypassPublicLaunchPreview(profile?.tipo_usuario_id);
    const isPreview = mode === 'preview';
    const showPreLaunchExperience = isPreview && !canBypassPreview;

    return {
        mode,
        isPreview,
        canBypassPreview,
        showPreLaunchExperience,
        isLoading: query.isLoading,
        isError: query.isError,
    };
}

export function useInvalidatePublicLaunchMode() {
    const queryClient = useQueryClient();
    return () => queryClient.invalidateQueries({ queryKey: [...PUBLIC_LAUNCH_MODE_QUERY_KEY] });
}

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface WristbandDetailsForAnalytics {
    id: string;
    wristband_id: string;
    event_id: string;
    wristband_code: string;
    wristband_price: number;
    wristband_access_type: string;
    event_type: string;
    event_data?: {
        purchase_date?: string;
        client_id?: string;
        transaction_id?: string;
    };
    created_at: string;
    client_user_id?: string;
    code_wristbands?: string;
    analytics_status: 'active' | 'used' | 'lost' | 'cancelled' | 'pending';
    sequential_number?: number;
    first_name?: string;
    last_name?: string;
    client_email?: string;
}

export interface EventTicketAnalyticsFilters {
    eventId: string;
    page?: number;
    pageSize?: number;
    searchQuery?: string;
}

export interface PaginatedEventTicketAnalytics {
    data: WristbandDetailsForAnalytics[];
    count: number;
}

const fetchEventTicketAnalytics = async (filters: EventTicketAnalyticsFilters): Promise<PaginatedEventTicketAnalytics> => {
    const { eventId, page = 1, pageSize = 10, searchQuery } = filters;

    if (!eventId) {
        return { data: [], count: 0 };
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
        .from('wristband_analytics_with_profile_details')
        .select('*', { count: 'exact' })
        .eq('event_id', eventId)
        .order('created_at', { ascending: true });

    if (searchQuery) {
        const searchPattern = `%${searchQuery.toLowerCase()}%`;
        query = query.or(
            `wristband_code.ilike.${searchPattern},
            first_name.ilike.${searchPattern},
            last_name.ilike.${searchPattern},
            client_email.ilike.${searchPattern}`
        );
    }

    const { data: analyticsWithProfiles, error: analyticsError, count } = await query.range(from, to);

    if (analyticsError) {
        console.error("Error fetching wristband analytics:", analyticsError);
        console.error("Full Supabase error object:", JSON.stringify(analyticsError, null, 2));
        throw analyticsError;
    }

    return {
        data: analyticsWithProfiles || [],
        count: count || 0,
    };
};

export const useEventTicketAnalytics = (filters: EventTicketAnalyticsFilters) => {
    return useQuery<PaginatedEventTicketAnalytics, Error>({
        queryKey: ['event-ticket-analytics', filters],
        queryFn: () => fetchEventTicketAnalytics(filters),
        enabled: !!filters.eventId,
    });
};


import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { callRpcRest } from '@/utils/supabase-rest-rpc';
import { withTimeout } from '@/utils/promise-timeout';

export type AdminDashboardMetrics = {
  total_profiles: number;
  manager_profiles: number;
  client_profiles: number;
  total_companies: number;
  profiles_this_month: number;
  companies_this_month: number;
  total_events: number;
  active_events: number;
  events_this_month: number;
};

/** Fallback quando a query falha ou ainda não retornou. */
export const EMPTY_ADMIN_METRICS: AdminDashboardMetrics = {
  total_profiles: 0,
  manager_profiles: 0,
  client_profiles: 0,
  total_companies: 0,
  profiles_this_month: 0,
  companies_this_month: 0,
  total_events: 0,
  active_events: 0,
  events_this_month: 0,
};

export type AdminActivityItem = {
  id: string;
  type: string;
  detail: string;
  date: string;
  status: 'success' | 'warning' | 'error' | 'info';
};

function coerceMetrics(raw: unknown): AdminDashboardMetrics | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
  return {
    total_profiles: n(o.total_profiles),
    manager_profiles: n(o.manager_profiles),
    client_profiles: n(o.client_profiles),
    total_companies: n(o.total_companies),
    profiles_this_month: n(o.profiles_this_month),
    companies_this_month: n(o.companies_this_month),
    total_events: n(o.total_events),
    active_events: n(o.active_events),
    events_this_month: n(o.events_this_month),
  };
}

async function measureApiLatencyMs(): Promise<number> {
  const t0 = performance.now();
  const { error } = await withTimeout(
    supabase.from('events').select('id').limit(1),
    5000,
    { data: null, error: { message: 'timeout' } },
  );
  const ms = Math.round(performance.now() - t0);
  if (error) return Math.max(ms, 200);
  return ms;
}

async function fetchRecentActivity(): Promise<AdminActivityItem[]> {
  const items: AdminActivityItem[] = [];

  let events: Record<string, unknown>[] | null = null;
  const evRes = await supabase
    .from('events')
    .select('id, title, created_at, status')
    .order('created_at', { ascending: false })
    .limit(8);

  if (evRes.error) {
    const fallback = await supabase.from('events').select('id, title, status').limit(8);
    events = (fallback.data || []) as Record<string, unknown>[];
  } else {
    events = (evRes.data || []) as Record<string, unknown>[];
  }

  for (const row of events || []) {
    const id = row.id as string;
    const title = (row.title as string)?.trim() || 'Evento';
    const created = row.created_at as string | null;
    if (!created) continue;
    const st = (row.status as string)?.toLowerCase();
    const status: AdminActivityItem['status'] =
      st === 'cancelled' ? 'error' : st === 'pending' ? 'warning' : 'success';
    items.push({
      id: `event-${id}`,
      type: 'Evento',
      detail: title,
      date: created.slice(0, 10),
      status,
    });
  }

  const { data: companies, error: coErr } = await supabase
    .from('companies')
    .select('id, trade_name, corporate_name, created_at')
    .order('created_at', { ascending: false })
    .limit(8);

  if (!coErr && companies?.length) {
    for (const row of companies) {
      const id = row.id as string;
      const name =
        ((row.trade_name as string)?.trim() ||
          (row.corporate_name as string)?.trim() ||
          'Empresa') as string;
      const created = row.created_at as string | null;
      if (!created) continue;
      items.push({
        id: `company-${id}`,
        type: 'Nova empresa',
        detail: name,
        date: created.slice(0, 10),
        status: 'info',
      });
    }
  }

  items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return items.slice(0, 12);
}

async function fetchMetrics(): Promise<AdminDashboardMetrics> {
  try {
    const rpcData = await callRpcRest<unknown>('get_admin_dashboard_metrics', {}, 12_000);
    const parsed = coerceMetrics(rpcData);
    if (parsed) return parsed;
  } catch (rpcError) {
    console.warn('[useAdminDashboardStats] RPC REST falhou, usando fallback from():', rpcError);
  }

  const [profilesRes, managersRes, clientsRes, companiesRes, eventsRes, activeRes] = await Promise.all([
    supabase.from('profiles').select('*', { count: 'exact', head: true }),
    supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('tipo_usuario_id', 2),
    supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('tipo_usuario_id', 3),
    supabase.from('companies').select('*', { count: 'exact', head: true }),
    supabase.from('events').select('*', { count: 'exact', head: true }),
    supabase.from('events').select('*', { count: 'exact', head: true }).eq('is_active', true),
  ]);

  return {
    total_profiles: profilesRes.count ?? 0,
    manager_profiles: managersRes.count ?? 0,
    client_profiles: clientsRes.count ?? 0,
    total_companies: companiesRes.count ?? 0,
    profiles_this_month: 0,
    companies_this_month: 0,
    total_events: eventsRes.count ?? 0,
    active_events: activeRes.count ?? 0,
    events_this_month: 0,
  };
}

export function useAdminDashboardStats(enabled: boolean) {
  return useQuery({
    queryKey: ['admin_dashboard_stats'],
    enabled,
    staleTime: 60_000,
    retry: 1,
    queryFn: async () => {
      const [metrics, recentActivity, apiLatencyMs] = await Promise.all([
        withTimeout(fetchMetrics(), 12_000, EMPTY_ADMIN_METRICS),
        withTimeout(fetchRecentActivity(), 12_000, [] as AdminActivityItem[]),
        measureApiLatencyMs(),
      ]);
      return { metrics, recentActivity, apiLatencyMs };
    },
  });
}

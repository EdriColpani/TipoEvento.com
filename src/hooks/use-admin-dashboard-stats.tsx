import { useQuery } from '@tanstack/react-query';
import { callRpcRest } from '@/utils/supabase-rest-rpc';
import { restGet } from '@/utils/supabase-rest';
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

const METRICS_TIMEOUT_MS = 6_000;
const ACTIVITY_TIMEOUT_MS = 5_000;
const LATENCY_TIMEOUT_MS = 3_000;

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
  try {
    await restGet<unknown[]>('events?select=id&limit=1', LATENCY_TIMEOUT_MS);
  } catch {
    /* latência alta ou sessão — ainda medimos o tempo */
  }
  return Math.round(performance.now() - t0);
}

async function fetchRecentActivity(): Promise<AdminActivityItem[]> {
  const items: AdminActivityItem[] = [];

  try {
    const events = await restGet<Array<Record<string, unknown>>>(
      'events?select=id,title,created_at,status&order=created_at.desc&limit=8',
      ACTIVITY_TIMEOUT_MS,
    );

    for (const row of events) {
      const id = String(row.id ?? '');
      const title = String(row.title ?? '').trim() || 'Evento';
      const created = row.created_at as string | null;
      if (!created) continue;
      const st = String(row.status ?? '').toLowerCase();
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
  } catch (error) {
    console.warn('[useAdminDashboardStats] atividade (eventos) indisponível:', error);
  }

  try {
    const companies = await restGet<Array<Record<string, unknown>>>(
      'companies?select=id,trade_name,corporate_name,created_at&order=created_at.desc&limit=8',
      ACTIVITY_TIMEOUT_MS,
    );

    for (const row of companies) {
      const id = String(row.id ?? '');
      const name =
        String(row.trade_name ?? '').trim() ||
        String(row.corporate_name ?? '').trim() ||
        'Empresa';
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
  } catch (error) {
    console.warn('[useAdminDashboardStats] atividade (empresas) indisponível:', error);
  }

  items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return items.slice(0, 12);
}

async function fetchMetrics(): Promise<AdminDashboardMetrics> {
  try {
    const rpcData = await callRpcRest<unknown>('get_admin_dashboard_metrics', {}, METRICS_TIMEOUT_MS);
    const parsed = coerceMetrics(rpcData);
    if (parsed) return parsed;
  } catch (rpcError) {
    console.warn('[useAdminDashboardStats] RPC indisponível, usando métricas vazias:', rpcError);
  }

  return EMPTY_ADMIN_METRICS;
}

export function useAdminDashboardStats(enabled: boolean) {
  return useQuery({
    queryKey: ['admin_dashboard_stats'],
    enabled,
    staleTime: 60_000,
    retry: 0,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const [metrics, recentActivity, apiLatencyMs] = await Promise.all([
        withTimeout(fetchMetrics(), METRICS_TIMEOUT_MS, EMPTY_ADMIN_METRICS),
        withTimeout(fetchRecentActivity(), ACTIVITY_TIMEOUT_MS, [] as AdminActivityItem[]),
        measureApiLatencyMs(),
      ]);
      return { metrics, recentActivity, apiLatencyMs };
    },
  });
}

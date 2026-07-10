import { useQuery } from '@tanstack/react-query';
import { restGet } from '@/utils/supabase-rest';

/** Pagamentos que contam como venda para relatório de público */
const RECEIVABLE_PAID_OR =
  'status.eq.paid,payment_status.eq.approved,payment_status.eq.authorized';

export interface AudienceReportRow {
  client_user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  cpf: string | null;
  gender: string | null;
  birth_date: string | null;
  total_tickets_purchased: number;
  /** Títulos de eventos com compra paga (após filtros de recebível) */
  events_attended: string[];
}

export interface AudienceReportFilters {
  eventId: string | null;
  gender: string | null;
  minAge: number | null;
  maxAge: number | null;
  startDate: string | null;
  endDate: string | null;
}

function endOfDayIso(dateYmd: string): string {
  const d = new Date(`${dateYmd}T23:59:59.999`);
  return d.toISOString();
}

function ticketCountFromReceivable(row: { wristband_analytics_ids?: unknown }): number {
  const ids = row.wristband_analytics_ids;
  if (Array.isArray(ids) && ids.length > 0) return ids.length;
  return 1;
}

function computeAge(birthDateStr: string | null | undefined): number | null {
  if (!birthDateStr) return null;
  const d = new Date(birthDateStr);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age -= 1;
  return age;
}

function normalizeGender(g: string | null | undefined): string | null {
  if (g == null || g === '') return null;
  return g;
}

type ReceivableRow = {
  id: string;
  client_user_id: string;
  event_id: string;
  created_at: string;
  wristband_analytics_ids: unknown;
  events: { title: string } | { title: string }[] | null;
};

type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  cpf: string | null;
  gender: string | null;
  birth_date: string | null;
};

export const fetchAudienceReport = async (
  managerUserId: string,
  isAdminMaster: boolean,
  filters: AudienceReportFilters,
): Promise<AudienceReportRow[]> => {
  const params: string[] = [
    'select=id,client_user_id,event_id,created_at,wristband_analytics_ids,events:event_id(title)',
    'client_user_id=not.is.null',
    `or=(${RECEIVABLE_PAID_OR})`,
  ];

  if (!isAdminMaster) {
    params.push(`manager_user_id=eq.${encodeURIComponent(managerUserId)}`);
  }
  if (filters.eventId) {
    params.push(`event_id=eq.${encodeURIComponent(filters.eventId)}`);
  }
  if (filters.startDate) {
    params.push(`created_at=gte.${encodeURIComponent(`${filters.startDate}T00:00:00.000Z`)}`);
  }
  if (filters.endDate) {
    params.push(`created_at=lte.${encodeURIComponent(endOfDayIso(filters.endDate))}`);
  }

  const receivables = await restGet<ReceivableRow[]>(
    `receivables?${params.join('&')}`,
    12_000,
  );
  const rows = receivables || [];
  if (rows.length === 0) return [];

  const byClient = new Map<
    string,
    { ticketCount: number; eventTitles: Set<string> }
  >();

  for (const r of rows) {
    const ev = r.events;
    const title = Array.isArray(ev) ? ev[0]?.title : ev?.title;
    const t = title && String(title).trim() ? String(title).trim() : 'Evento';
    const n = ticketCountFromReceivable(r);
    if (!byClient.has(r.client_user_id)) {
      byClient.set(r.client_user_id, { ticketCount: 0, eventTitles: new Set() });
    }
    const acc = byClient.get(r.client_user_id)!;
    acc.ticketCount += n;
    acc.eventTitles.add(t);
  }

  const clientIds = [...byClient.keys()];
  const profiles = await restGet<ProfileRow[]>(
    `profiles?select=id,first_name,last_name,cpf,gender,birth_date&id=in.(${clientIds.map(encodeURIComponent).join(',')})`,
    12_000,
  );

  const profileMap = new Map((profiles || []).map((p) => [p.id, p]));

  const result: AudienceReportRow[] = [];

  for (const clientId of clientIds) {
    const prof = profileMap.get(clientId);
    const agg = byClient.get(clientId)!;
    const g = normalizeGender(prof?.gender ?? null);
    if (filters.gender) {
      if (!g || g !== filters.gender) continue;
    }
    const age = computeAge(prof?.birth_date ?? null);
    if (filters.minAge != null) {
      if (age == null || age < filters.minAge) continue;
    }
    if (filters.maxAge != null) {
      if (age == null || age > filters.maxAge) continue;
    }

    result.push({
      client_user_id: clientId,
      first_name: prof?.first_name?.trim() || '—',
      last_name: prof?.last_name?.trim() || '',
      email: '—',
      cpf: prof?.cpf ?? null,
      gender: g,
      birth_date: prof?.birth_date ?? null,
      total_tickets_purchased: agg.ticketCount,
      events_attended: [...agg.eventTitles].sort((a, b) =>
        a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }),
      ),
    });
  }

  return result.sort((a, b) => {
    const na = `${a.first_name} ${a.last_name}`.trim().toLowerCase();
    const nb = `${b.first_name} ${b.last_name}`.trim().toLowerCase();
    return na.localeCompare(nb, 'pt-BR');
  });
};

export const useAudienceReport = (
  managerUserId: string | undefined,
  isAdminMaster: boolean,
  filters: AudienceReportFilters,
  enabled: boolean,
) => {
  return useQuery({
    queryKey: ['audience_report', managerUserId, isAdminMaster, filters],
    queryFn: () => fetchAudienceReport(managerUserId!, isAdminMaster, filters),
    enabled: enabled && !!managerUserId,
    staleTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
};

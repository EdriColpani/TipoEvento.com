import { useQuery } from '@tanstack/react-query';
import { restGet } from '@/utils/supabase-rest';
import {
    BRAZIL_UF_CODES,
    normalizeBrazilUf,
    type BrazilUfCode,
} from '@/utils/brazil-uf';

export type AdminUsageCityRow = {
    city: string;
    uf: BrazilUfCode | null;
    companies: number;
    events: number;
    activeEvents: number;
};

export type AdminDashboardUsageGeo = {
    byUf: Array<{ uf: BrazilUfCode; count: number }>;
    topCities: AdminUsageCityRow[];
    activeEvents: Array<{
        id: string;
        title: string;
        date: string | null;
        city: string | null;
        uf: BrazilUfCode | null;
    }>;
    knownCompanies: number;
    unknownCompanies: number;
};

type CompanyRow = { id: string; city?: string | null; state?: string | null };
type EventRow = {
    id: string;
    title?: string | null;
    date?: string | null;
    is_active?: boolean | null;
    company_id?: string | null;
};

const EMPTY: AdminDashboardUsageGeo = {
    byUf: BRAZIL_UF_CODES.map((uf) => ({ uf, count: 0 })),
    topCities: [],
    activeEvents: [],
    knownCompanies: 0,
    unknownCompanies: 0,
};

function cityKey(city: string, uf: BrazilUfCode | null): string {
    return `${city.trim().toLocaleLowerCase('pt-BR')}|${uf ?? ''}`;
}

function titleCaseCity(raw: string): string {
    return raw
        .trim()
        .split(/\s+/)
        .map((w) => (w.length <= 2 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
        .join(' ');
}

async function fetchUsageGeo(): Promise<AdminDashboardUsageGeo> {
    const [companies, events] = await Promise.all([
        restGet<CompanyRow[]>('companies?select=id,city,state&limit=2000', 12_000),
        restGet<EventRow[]>(
            'events?select=id,title,date,is_active,company_id&order=date.asc&limit=2000',
            12_000,
        ),
    ]);

    const companyById = new Map<string, { city: string | null; uf: BrazilUfCode | null }>();
    const ufCounts = new Map<BrazilUfCode, number>();
    for (const uf of BRAZIL_UF_CODES) ufCounts.set(uf, 0);

    let knownCompanies = 0;
    let unknownCompanies = 0;
    const cities = new Map<string, AdminUsageCityRow>();

    for (const company of companies ?? []) {
        const uf = normalizeBrazilUf(company.state);
        const city = String(company.city ?? '').trim();
        companyById.set(company.id, { city: city || null, uf });
        if (!uf && !city) {
            unknownCompanies += 1;
            continue;
        }
        knownCompanies += 1;
        if (uf) ufCounts.set(uf, (ufCounts.get(uf) ?? 0) + 1);
        if (city) {
            const key = cityKey(city, uf);
            const prev = cities.get(key);
            if (prev) prev.companies += 1;
            else {
                cities.set(key, {
                    city: titleCaseCity(city),
                    uf,
                    companies: 1,
                    events: 0,
                    activeEvents: 0,
                });
            }
        }
    }

    const activeEvents: AdminDashboardUsageGeo['activeEvents'] = [];

    for (const event of events ?? []) {
        const geo = event.company_id ? companyById.get(event.company_id) : undefined;
        const uf = geo?.uf ?? null;
        const city = geo?.city ?? null;
        if (city) {
            const key = cityKey(city, uf);
            const prev = cities.get(key);
            if (prev) {
                prev.events += 1;
                if (event.is_active) prev.activeEvents += 1;
            } else {
                cities.set(key, {
                    city: titleCaseCity(city),
                    uf,
                    companies: 0,
                    events: 1,
                    activeEvents: event.is_active ? 1 : 0,
                });
            }
        }
        if (event.is_active) {
            activeEvents.push({
                id: event.id,
                title: String(event.title ?? '').trim() || 'Evento',
                date: event.date ?? null,
                city,
                uf,
            });
        }
    }

    const byUf = BRAZIL_UF_CODES.map((uf) => ({ uf, count: ufCounts.get(uf) ?? 0 }));
    const topCities = [...cities.values()]
        .sort((a, b) => b.companies + b.events - (a.companies + a.events))
        .slice(0, 8);

    return {
        byUf,
        topCities,
        activeEvents: activeEvents.slice(0, 8),
        knownCompanies,
        unknownCompanies,
    };
}

export function useAdminDashboardUsageGeo(enabled: boolean) {
    return useQuery<AdminDashboardUsageGeo>({
        queryKey: ['adminDashboardUsageGeo'],
        queryFn: async () => {
            try {
                return await fetchUsageGeo();
            } catch {
                return EMPTY;
            }
        },
        enabled,
        staleTime: 60_000,
        placeholderData: EMPTY,
    });
}

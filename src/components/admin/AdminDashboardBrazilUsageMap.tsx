import React, { useMemo, useState } from 'react';
import brazilMap from '@/assets/brazil-svg-map';
import type { AdminDashboardUsageGeo } from '@/hooks/use-admin-dashboard-usage-geo';
import { UF_LABELS, type BrazilUfCode } from '@/utils/brazil-uf';
import { formatEventDateForDisplay } from '@/utils/format-event-date';

const EMPTY_FILL = '#3a2e14';
const EMPTY_STROKE = '#eab308';
const ACTIVE_STROKE = '#fde047';

function heatColor(count: number, max: number): string {
    if (count <= 0 || max <= 0) return EMPTY_FILL;
    const t = Math.min(1, count / max);
    const r = Math.round(58 + (234 - 58) * t);
    const g = Math.round(46 + (179 - 46) * t);
    const b = Math.round(20 + (8 - 20) * t);
    return `rgb(${r},${g},${b})`;
}

type Props = {
    data: AdminDashboardUsageGeo;
};

const AdminDashboardBrazilUsageMap: React.FC<Props> = ({ data }) => {
    const [hoverUf, setHoverUf] = useState<BrazilUfCode | null>(null);

    const countByUf = useMemo(() => {
        const m = new Map<string, number>();
        for (const row of data.byUf) m.set(row.uf, row.count);
        return m;
    }, [data.byUf]);

    const maxCount = useMemo(
        () => data.byUf.reduce((m, r) => Math.max(m, r.count), 0),
        [data.byUf],
    );

    const hoverCount = hoverUf ? countByUf.get(hoverUf) || 0 : 0;
    const hasAny = data.knownCompanies > 0 || data.topCities.length > 0;

    return (
        <div className="bg-black border border-yellow-500/30 rounded-2xl p-6 h-full">
            <h3 className="text-lg sm:text-xl font-semibold text-white mb-1">Uso no Brasil</h3>
            <p className="text-xs text-gray-500 mb-4">
                Empresas e eventos por UF/cidade do cadastro. Eventos herdam a cidade da empresa.
            </p>
            <div className="relative min-h-[220px]">
                <svg
                    viewBox={brazilMap.viewBox}
                    className="w-full h-full max-h-[260px]"
                    role="img"
                    aria-label="Mapa de uso por UF"
                >
                    {brazilMap.locations.map((loc) => {
                        const uf = loc.id.toUpperCase() as BrazilUfCode;
                        const count = countByUf.get(uf) || 0;
                        const active = hoverUf === uf;
                        return (
                            <path
                                key={loc.id}
                                d={loc.path}
                                fill={heatColor(count, maxCount)}
                                stroke={active ? ACTIVE_STROKE : EMPTY_STROKE}
                                strokeWidth={active ? 2.4 : 1.4}
                                strokeLinejoin="round"
                                vectorEffect="non-scaling-stroke"
                                className="cursor-pointer transition-[fill,stroke] duration-150"
                                onMouseEnter={() => setHoverUf(uf)}
                                onMouseLeave={() => setHoverUf(null)}
                            >
                                <title>
                                    {UF_LABELS[uf] || loc.name}: {count.toLocaleString('pt-BR')} empresa
                                    {count === 1 ? '' : 's'}
                                </title>
                            </path>
                        );
                    })}
                </svg>
                {hoverUf ? (
                    <div className="absolute top-1 right-1 rounded-md bg-black/80 border border-yellow-500/40 px-2 py-1 text-xs text-white pointer-events-none">
                        <span className="text-yellow-400 font-semibold">{hoverUf}</span>
                        {' · '}
                        {hoverCount.toLocaleString('pt-BR')} empresa{hoverCount === 1 ? '' : 's'}
                    </div>
                ) : null}
            </div>

            {hasAny ? (
                <ul className="mt-4 flex flex-wrap gap-1.5">
                    {data.topCities.map((row) => (
                        <li
                            key={`${row.city}-${row.uf ?? 'xx'}`}
                            className="text-[11px] px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-200 ring-1 ring-yellow-500/30"
                        >
                            {row.city}
                            {row.uf ? `/${row.uf}` : ''} · {row.companies} emp. · {row.activeEvents} ativo
                            {row.activeEvents === 1 ? '' : 's'}
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-xs text-gray-500 mt-4 text-center">
                    Nenhuma empresa com cidade/UF cadastrada ainda.
                </p>
            )}

            {data.activeEvents.length > 0 ? (
                <div className="mt-5 border-t border-yellow-500/20 pt-4">
                    <p className="text-xs uppercase tracking-wide text-yellow-500 mb-2">Eventos ativos</p>
                    <ul className="space-y-2 max-h-[180px] overflow-y-auto">
                        {data.activeEvents.map((event) => (
                            <li key={event.id} className="text-sm text-gray-200">
                                <span className="text-white font-medium">{event.title}</span>
                                <span className="text-gray-500 text-xs ml-2">
                                    {formatEventDateForDisplay(event.date) || 'sem data'}
                                    {event.city
                                        ? ` · ${event.city}${event.uf ? `/${event.uf}` : ''}`
                                        : ''}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </div>
    );
};

export default AdminDashboardBrazilUsageMap;

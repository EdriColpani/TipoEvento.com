import React, { useMemo, useState } from 'react';
import brazilMap from '@/assets/brazil-svg-map';
import type { ManagerDashboardAccessMapData } from '@/hooks/use-manager-dashboard-access-map';
import { UF_LABELS, type BrazilUfCode } from '@/utils/brazil-uf';
import { dashMuted } from '@/constants/manager-dashboard-ui';

type Props = {
    data: ManagerDashboardAccessMapData;
};

/** Base visível no fundo preto; heat sobe até cyan-400. */
const EMPTY_FILL = '#1e3a4c';
const EMPTY_STROKE = '#67e8f9';
const ACTIVE_STROKE = '#a5f3fc';

function heatColor(count: number, max: number): string {
    if (count <= 0 || max <= 0) return EMPTY_FILL;
    const t = Math.min(1, count / max);
    // #1e3a4c → #22d3ee
    const r = Math.round(30 + (34 - 30) * t);
    const g = Math.round(58 + (211 - 58) * t);
    const b = Math.round(76 + (238 - 76) * t);
    return `rgb(${r},${g},${b})`;
}

const ManagerDashboardAccessMap: React.FC<Props> = ({ data }) => {
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
    const hasAny = data.knownTickets > 0;

    return (
        <div className="h-full flex flex-col gap-2">
            <div className="relative flex-1 min-h-[160px]">
                <svg
                    viewBox={brazilMap.viewBox}
                    className="w-full h-full max-h-[200px]"
                    role="img"
                    aria-label="Mapa de acessos por UF"
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
                                    {UF_LABELS[uf] || loc.name}: {count.toLocaleString('pt-BR')}{' '}
                                    ingresso{count === 1 ? '' : 's'}
                                </title>
                            </path>
                        );
                    })}
                </svg>
                {hoverUf && (
                    <div className="absolute top-1 right-1 rounded-md bg-black/80 border border-cyan-500/40 px-2 py-1 text-xs text-white pointer-events-none">
                        <span className="text-cyan-300 font-semibold">{hoverUf}</span>
                        {' · '}
                        {hoverCount.toLocaleString('pt-BR')} ingresso{hoverCount === 1 ? '' : 's'}
                    </div>
                )}
            </div>

            {hasAny ? (
                <div className="space-y-1">
                    <p className={`${dashMuted} text-[11px] leading-snug`}>
                        Origem dos compradores · {data.coveragePercent.toFixed(0)}% com UF no
                        perfil
                        {data.unknownTickets > 0
                            ? ` (${data.unknownTickets.toLocaleString('pt-BR')} sem localização)`
                            : ''}
                    </p>
                    {data.topUfs.length > 0 && (
                        <ul className="flex flex-wrap gap-1.5">
                            {data.topUfs.map((row) => (
                                <li
                                    key={row.uf}
                                    className="text-[11px] px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-400/30"
                                >
                                    {row.uf} {row.count.toLocaleString('pt-BR')}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            ) : (
                <p className={`${dashMuted} text-xs text-center`}>
                    Sem compras com UF conhecida nos últimos {data.periodDays} dias.
                </p>
            )}
        </div>
    );
};

export default ManagerDashboardAccessMap;

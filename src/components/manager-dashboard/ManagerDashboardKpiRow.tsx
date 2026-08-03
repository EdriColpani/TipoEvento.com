import React from 'react';
import { CalendarCheck, Ticket, DollarSign, UserCheck, Wallet } from 'lucide-react';
import type { DashboardData } from '@/hooks/use-dashboard-data';
import type { ManagerDashboardExtraKpis } from '@/hooks/use-manager-dashboard-extra-kpis';
import { dashIconTone } from '@/constants/manager-dashboard-ui';
import ManagerDashboardKpiCard from './ManagerDashboardKpiCard';

type Props = {
    data: DashboardData;
    extra?: ManagerDashboardExtraKpis;
    showCreditsKpi: boolean;
    extraLoading?: boolean;
};

function formatDelta(pct: number): { label: string; positive: boolean } {
    const positive = pct >= 0;
    return {
        label: `${positive ? '+' : ''}${pct.toFixed(1)}%`,
        positive,
    };
}

const ManagerDashboardKpiRow: React.FC<Props> = ({
    data,
    extra,
    showCreditsKpi,
    extraLoading = false,
}) => {
    const salesDelta = formatDelta(data.sales.salesPercentageChange);
    const ticketsDelta = formatDelta(data.sales.ticketsPercentageChange);
    const checkInsDelta = formatDelta(extra?.checkInsPercentageChange ?? 0);
    const creditsDelta = formatDelta(extra?.creditsPercentageChange ?? 0);

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8">
            <ManagerDashboardKpiCard
                title="Ingressos vendidos"
                value={data.sales.currentMonthTicketsSold.toLocaleString('pt-BR')}
                subtitle="vs 30 dias anteriores"
                deltaLabel={ticketsDelta.label}
                deltaPositive={ticketsDelta.positive}
                icon={Ticket}
                tone={dashIconTone.tickets}
            />
            <ManagerDashboardKpiCard
                title="Receita líquida"
                value={data.sales.currentMonthTotalSales.toLocaleString('pt-BR', {
                    style: 'currency',
                    currency: 'BRL',
                })}
                subtitle="após comissão · vs 30 dias anteriores"
                deltaLabel={salesDelta.label}
                deltaPositive={salesDelta.positive}
                icon={DollarSign}
                tone={dashIconTone.revenue}
            />
            <ManagerDashboardKpiCard
                title="Check-ins"
                value={
                    extraLoading && !extra
                        ? '…'
                        : (extra?.checkIns ?? 0).toLocaleString('pt-BR')
                }
                subtitle="vs 30 dias anteriores"
                deltaLabel={extraLoading && !extra ? undefined : checkInsDelta.label}
                deltaPositive={extraLoading && !extra ? null : checkInsDelta.positive}
                icon={UserCheck}
                tone={dashIconTone.checkins}
            />
            {showCreditsKpi ? (
                <ManagerDashboardKpiCard
                    title="Créditos consumidos"
                    value={
                        extraLoading && !extra
                            ? '…'
                            : (extra?.creditsConsumed ?? 0).toLocaleString('pt-BR', {
                                  style: 'currency',
                                  currency: 'BRL',
                              })
                    }
                    subtitle="vs 30 dias anteriores"
                    deltaLabel={extraLoading && !extra ? undefined : creditsDelta.label}
                    deltaPositive={extraLoading && !extra ? null : creditsDelta.positive}
                    icon={Wallet}
                    tone={dashIconTone.credits}
                />
            ) : (
                <ManagerDashboardKpiCard
                    title="Eventos ativos"
                    value={String(data.events.activeEvents)}
                    subtitle={`${data.events.activeEvents}/${data.events.totalEvents} ativos/total`}
                    icon={CalendarCheck}
                    tone={dashIconTone.events}
                />
            )}
        </div>
    );
};

export default ManagerDashboardKpiRow;

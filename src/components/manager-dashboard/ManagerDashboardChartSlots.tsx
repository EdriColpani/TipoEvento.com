import React from 'react';
import { AreaChart, Loader2, Map, PieChart } from 'lucide-react';
import type { ManagerDashboardChartsData } from '@/hooks/use-manager-dashboard-charts';
import type { ManagerDashboardAccessMapData } from '@/hooks/use-manager-dashboard-access-map';
import { dashMuted, dashPanel, dashSpinner, dashTitle } from '@/constants/manager-dashboard-ui';
import ManagerDashboardTicketsTrendChart from './ManagerDashboardTicketsTrendChart';
import ManagerDashboardChannelDonut from './ManagerDashboardChannelDonut';
import ManagerDashboardAccessMap from './ManagerDashboardAccessMap';

type Props = {
    charts?: ManagerDashboardChartsData;
    accessMap?: ManagerDashboardAccessMapData;
    isLoading?: boolean;
    isError?: boolean;
    isLoadingAccessMap?: boolean;
    isErrorAccessMap?: boolean;
};

const PanelShell: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <div className={`${dashPanel} min-h-[280px] flex flex-col`}>
        <h3 className={`${dashTitle} mb-4`}>{title}</h3>
        <div className="flex-1 min-h-[200px]">{children}</div>
    </div>
);

const EmptyState: React.FC<{ icon: React.ElementType; message: string }> = ({
    icon: Icon,
    message,
}) => (
    <div className="h-full rounded-xl bg-black/40 border border-cyan-500/10 flex flex-col items-center justify-center px-4 text-center">
        <Icon className="h-10 w-10 text-cyan-500/40 mb-3" />
        <p className={`${dashMuted} text-sm`}>{message}</p>
    </div>
);

const LoadingState: React.FC = () => (
    <div className="h-full flex flex-col items-center justify-center">
        <Loader2 className={`h-8 w-8 animate-spin ${dashSpinner} mb-2`} />
        <p className={`${dashMuted} text-sm`}>Carregando...</p>
    </div>
);

const ManagerDashboardChartSlots: React.FC<Props> = ({
    charts,
    accessMap,
    isLoading = false,
    isError = false,
    isLoadingAccessMap = false,
    isErrorAccessMap = false,
}) => {
    const ticketsTrend = charts?.ticketsTrend ?? [];
    const hasTickets = ticketsTrend.some((p) => p.count > 0);
    const channelSlices = charts?.salesByChannel ?? [];
    const hasChannels = channelSlices.some((s) => s.amount > 0);
    const periodDays = charts?.periodDays ?? 45;
    const hasMapData = (accessMap?.knownTickets ?? 0) > 0 || (accessMap?.unknownTickets ?? 0) > 0;

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 mb-8">
            <PanelShell title="Ingressos no tempo">
                {isLoading ? (
                    <LoadingState />
                ) : isError ? (
                    <EmptyState icon={AreaChart} message="Erro ao carregar a série de ingressos." />
                ) : hasTickets ? (
                    <div className="h-[200px] w-full">
                        <ManagerDashboardTicketsTrendChart data={ticketsTrend} />
                    </div>
                ) : (
                    <EmptyState
                        icon={AreaChart}
                        message={`Nenhum ingresso vendido nos últimos ${periodDays} dias.`}
                    />
                )}
            </PanelShell>

            <PanelShell title="Vendas por canal">
                {isLoading ? (
                    <LoadingState />
                ) : isError ? (
                    <EmptyState icon={PieChart} message="Erro ao carregar vendas por canal." />
                ) : hasChannels ? (
                    <div className="h-[200px] w-full">
                        <ManagerDashboardChannelDonut data={channelSlices} />
                    </div>
                ) : (
                    <EmptyState
                        icon={PieChart}
                        message="Sem faturamento no período para montar o donut."
                    />
                )}
            </PanelShell>

            <PanelShell title="Acessos por região">
                {isLoadingAccessMap ? (
                    <LoadingState />
                ) : isErrorAccessMap ? (
                    <EmptyState icon={Map} message="Erro ao carregar o mapa de acessos." />
                ) : accessMap && hasMapData ? (
                    <ManagerDashboardAccessMap data={accessMap} />
                ) : (
                    <EmptyState
                        icon={Map}
                        message={`Sem compras nos últimos ${accessMap?.periodDays ?? periodDays} dias para mapear origem.`}
                    />
                )}
            </PanelShell>
        </div>
    );
};

export default ManagerDashboardChartSlots;

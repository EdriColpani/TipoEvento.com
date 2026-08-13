import React from 'react';
import { Loader2 } from 'lucide-react';
import { usePageAuth } from '@/hooks/use-page-auth';
import { EMPTY_DASHBOARD, useDashboardData } from '@/hooks/use-dashboard-data';
import { useManagerDashboardCharts } from '@/hooks/use-manager-dashboard-charts';
import { useManagerDashboardToday } from '@/hooks/use-manager-dashboard-today';
import { useManagerDashboardAccessMap } from '@/hooks/use-manager-dashboard-access-map';
import { useManagerDashboardExtraKpis } from '@/hooks/use-manager-dashboard-extra-kpis';
import { useProfile } from '@/hooks/use-profile';
import { useManagerCompany } from '@/hooks/use-manager-company';
import { useCompanyTicketInactivity } from '@/hooks/use-company-ticket-inactivity';
import { useCreditReportsAccess } from '@/hooks/use-credit-reports-access';
import TicketInactivityBanner from '@/components/TicketInactivityBanner';
import ManagerDashboardKpiRow from '@/components/manager-dashboard/ManagerDashboardKpiRow';
import ManagerDashboardChartSlots from '@/components/manager-dashboard/ManagerDashboardChartSlots';
import ManagerDashboardTodaySlots from '@/components/manager-dashboard/ManagerDashboardTodaySlots';
import ManagerDashboardQuickActions from '@/components/manager-dashboard/ManagerDashboardQuickActions';
import { dashMuted, dashSpinner } from '@/constants/manager-dashboard-ui';

const ManagerDashboard: React.FC = () => {
    const { userId, authPending } = usePageAuth();
    const { profile } = useProfile(userId);
    const { company } = useManagerCompany(userId);
    const { data: inactivityStatus, isLoading: isLoadingInactivity } = useCompanyTicketInactivity(
        company?.id,
    );
    const isAdminMaster = profile?.tipo_usuario_id === 1;
    const { data: dashboardData, isLoading } = useDashboardData(
        userId,
        isAdminMaster || false,
    );
    const { showCreditReportCards } = useCreditReportsAccess(userId);
    const chartsEnabled = !!userId || isAdminMaster;
    const {
        data: chartsData,
        isLoading: isLoadingCharts,
        isError: isErrorCharts,
    } = useManagerDashboardCharts({
        userId,
        companyId: company?.id,
        isAdminMaster: isAdminMaster || false,
        includeCredit: showCreditReportCards,
        periodDays: 45,
        enabled: chartsEnabled,
    });
    const {
        data: accessMapData,
        isLoading: isLoadingAccessMap,
        isError: isErrorAccessMap,
    } = useManagerDashboardAccessMap({
        userId,
        isAdminMaster: isAdminMaster || false,
        periodDays: 45,
        enabled: chartsEnabled,
    });
    const {
        data: todayData,
        isLoading: isLoadingToday,
        isError: isErrorToday,
    } = useManagerDashboardToday({
        userId,
        companyId: company?.id,
        isAdminMaster: isAdminMaster || false,
        includeCredit: showCreditReportCards,
        enabled: chartsEnabled,
    });
    const { data: extraKpis, isLoading: isLoadingExtraKpis } = useManagerDashboardExtraKpis({
        userId,
        companyId: company?.id,
        isAdminMaster: isAdminMaster || false,
        includeCredit: showCreditReportCards,
        enabled: chartsEnabled,
    });

    const dashboardBootPending = authPending && !userId;
    const statsBootPending = dashboardBootPending || (isLoading && !dashboardData);
    const safeDashboard = dashboardData ?? EMPTY_DASHBOARD;

    return (
        <div className="max-w-7xl mx-auto">
            <div className="mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-white mb-2">Dashboard</h1>
                <p className={`${dashMuted} text-sm sm:text-base`}>
                    Visão geral de ingressos, receita e operação dos seus eventos
                </p>
            </div>

            <TicketInactivityBanner status={inactivityStatus} isLoading={isLoadingInactivity} />

            {statsBootPending && (
                <div className="text-center py-20">
                    <Loader2 className={`h-10 w-10 animate-spin ${dashSpinner} mx-auto mb-4`} />
                    <p className={dashMuted}>Carregando dados do dashboard...</p>
                </div>
            )}

            {!statsBootPending && (
                <>
                    <ManagerDashboardKpiRow
                        data={safeDashboard}
                        extra={extraKpis}
                        showCreditsKpi={showCreditReportCards}
                        extraLoading={isLoadingExtraKpis}
                    />
                    <ManagerDashboardChartSlots
                        charts={chartsData}
                        accessMap={accessMapData}
                        isLoading={isLoadingCharts}
                        isError={isErrorCharts}
                        isLoadingAccessMap={isLoadingAccessMap}
                        isErrorAccessMap={isErrorAccessMap}
                    />
                    <ManagerDashboardTodaySlots
                        data={todayData}
                        isLoading={isLoadingToday}
                        isError={isErrorToday}
                    />
                    <ManagerDashboardQuickActions />
                </>
            )}
        </div>
    );
};

export default ManagerDashboard;

import React from 'react';
import { Loader2, Receipt, Ticket, Users } from 'lucide-react';
import type { ManagerDashboardTodayData } from '@/hooks/use-manager-dashboard-today';
import { dashIconTone, dashMuted, dashPanel, dashSpinner, dashTitle } from '@/constants/manager-dashboard-ui';

type TodayCardProps = {
    title: string;
    value: string;
    subtitle: string;
    icon: React.ElementType;
    toneWrap: string;
    toneIcon: string;
};

const TodayCard: React.FC<TodayCardProps> = ({
    title,
    value,
    subtitle,
    icon: Icon,
    toneWrap,
    toneIcon,
}) => (
    <div className={dashPanel}>
        <div className="flex items-center gap-3 mb-4">
            <div className={`w-10 h-10 ${toneWrap} rounded-xl flex items-center justify-center`}>
                <Icon className={`${toneIcon} h-5 w-5`} />
            </div>
            <h3 className={dashTitle}>{title}</h3>
        </div>
        <div className="text-2xl sm:text-3xl font-bold text-white mb-1">{value}</div>
        <p className={`${dashMuted} text-sm`}>{subtitle}</p>
    </div>
);

type Props = {
    data?: ManagerDashboardTodayData;
    isLoading?: boolean;
    isError?: boolean;
};

function formatMoney(value: number): string {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const ManagerDashboardTodaySlots: React.FC<Props> = ({
    data,
    isLoading = false,
    isError = false,
}) => {
    if (isLoading) {
        return (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 mb-8">
                {[0, 1, 2].map((i) => (
                    <div key={i} className={`${dashPanel} min-h-[140px] flex items-center justify-center`}>
                        <Loader2 className={`h-7 w-7 animate-spin ${dashSpinner}`} />
                    </div>
                ))}
            </div>
        );
    }

    if (isError) {
        return (
            <div className={`${dashPanel} mb-8 text-center py-8`}>
                <p className="text-red-400 text-sm">Erro ao carregar as métricas de hoje.</p>
            </div>
        );
    }

    const participants = data?.participants ?? 0;
    const consumption = data?.consumption ?? 0;
    const ticketsSold = data?.ticketsSold ?? 0;
    const avgTicket = data?.avgTicket ?? 0;

    return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 mb-8">
            <TodayCard
                title="Participantes hoje"
                value={participants.toLocaleString('pt-BR')}
                subtitle="Check-ins únicos (entradas na portaria)"
                icon={Users}
                toneWrap={dashIconTone.today.wrap}
                toneIcon={dashIconTone.today.icon}
            />
            <TodayCard
                title="Consumo hoje"
                value={formatMoney(consumption)}
                subtitle="Ingressos + crédito no dia (horário de Brasília)"
                icon={Receipt}
                toneWrap={dashIconTone.revenue.wrap}
                toneIcon={dashIconTone.revenue.icon}
            />
            <TodayCard
                title="Ticket médio"
                value={ticketsSold > 0 ? formatMoney(avgTicket) : '—'}
                subtitle={
                    ticketsSold > 0
                        ? `Consumo ÷ ${ticketsSold.toLocaleString('pt-BR')} ingresso${ticketsSold === 1 ? '' : 's'} vendido${ticketsSold === 1 ? '' : 's'} hoje`
                        : 'Sem ingressos vendidos hoje'
                }
                icon={Ticket}
                toneWrap={dashIconTone.tickets.wrap}
                toneIcon={dashIconTone.tickets.icon}
            />
        </div>
    );
};

export default ManagerDashboardTodaySlots;

import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { dashMuted, dashPanel, dashPanelHover } from '@/constants/manager-dashboard-ui';

export type ManagerDashboardKpiTone = {
    wrap: string;
    icon: string;
};

type Props = {
    title: string;
    value: string;
    subtitle?: string;
    deltaLabel?: string;
    deltaPositive?: boolean | null;
    icon: LucideIcon;
    tone: ManagerDashboardKpiTone;
    pending?: boolean;
};

const ManagerDashboardKpiCard: React.FC<Props> = ({
    title,
    value,
    subtitle,
    deltaLabel,
    deltaPositive = null,
    icon: Icon,
    tone,
    pending = false,
}) => {
    const deltaClass =
        deltaPositive === true
            ? 'text-emerald-400'
            : deltaPositive === false
              ? 'text-red-400'
              : dashMuted;

    return (
        <div className={`${dashPanel} ${dashPanelHover}`}>
            <div className="flex items-center justify-between mb-4">
                <div className={`w-10 h-10 sm:w-12 sm:h-12 ${tone.wrap} rounded-xl flex items-center justify-center`}>
                    <Icon className={`${tone.icon} h-5 w-5 sm:h-6 sm:w-6`} />
                </div>
                {deltaLabel ? (
                    <div className="text-right">
                        <div className={`text-sm font-semibold ${deltaClass}`}>{deltaLabel}</div>
                        {subtitle ? <div className={`${dashMuted} text-xs`}>{subtitle}</div> : null}
                    </div>
                ) : subtitle ? (
                    <div className={`${dashMuted} text-xs text-right max-w-[8rem]`}>{subtitle}</div>
                ) : null}
            </div>
            <div>
                <div className={`text-xl sm:text-2xl font-bold text-white mb-1 ${pending ? 'opacity-70' : ''}`}>
                    {value}
                </div>
                <div className={`${dashMuted} text-sm`}>{title}</div>
            </div>
        </div>
    );
};

export default ManagerDashboardKpiCard;

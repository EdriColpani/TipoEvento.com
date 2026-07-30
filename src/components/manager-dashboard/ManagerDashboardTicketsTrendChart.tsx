import React from 'react';
import { Line } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Filler,
    Title,
    Tooltip,
    Legend,
} from 'chart.js';
import type { ChartOptions } from 'chart.js';
import { formatEventDateForDisplay } from '@/utils/format-event-date';
import type { DashboardTicketsTrendPoint } from '@/hooks/use-manager-dashboard-charts';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Filler,
    Title,
    Tooltip,
    Legend,
);

const LINE = '#22d3ee';
const LINE_SOFT = 'rgba(34, 211, 238, 0.18)';
const POINT_BORDER = '#0ea5e9';
const TICK_COLOR = '#cbd5e1';

type Props = {
    data: DashboardTicketsTrendPoint[];
};

const ManagerDashboardTicketsTrendChart: React.FC<Props> = ({ data }) => {
    const chartData = {
        labels: data.map((point) => formatEventDateForDisplay(point.date) || point.date),
        datasets: [
            {
                label: 'Ingressos',
                data: data.map((point) => point.count),
                borderColor: LINE,
                backgroundColor: LINE_SOFT,
                tension: 0.35,
                fill: true,
                pointRadius: 3,
                pointHoverRadius: 5,
                pointBackgroundColor: LINE,
                pointBorderColor: POINT_BORDER,
                pointBorderWidth: 2,
            },
        ],
    };

    const options: ChartOptions<'line'> = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: {
                callbacks: {
                    label(ctx) {
                        const v = Number(ctx.parsed.y ?? 0);
                        return `${v.toLocaleString('pt-BR')} ingresso${v === 1 ? '' : 's'}`;
                    },
                },
            },
        },
        scales: {
            x: {
                grid: { color: 'rgba(255, 255, 255, 0.08)' },
                ticks: {
                    color: TICK_COLOR,
                    maxRotation: 45,
                    autoSkip: true,
                    maxTicksLimit: 8,
                },
            },
            y: {
                beginAtZero: true,
                grid: { color: 'rgba(255, 255, 255, 0.08)' },
                ticks: {
                    color: TICK_COLOR,
                    precision: 0,
                    callback(value) {
                        return Number(value).toLocaleString('pt-BR');
                    },
                },
            },
        },
    };

    return <Line data={chartData} options={options} />;
};

export default ManagerDashboardTicketsTrendChart;

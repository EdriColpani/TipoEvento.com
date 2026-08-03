import React, { useMemo } from 'react';
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

/** Sempre inclui o primeiro e o último dia (autoSkip do Chart.js escondia o hoje). */
function pickVisibleTickIndices(total: number, maxTicks: number): Set<number> {
    if (total <= 0) return new Set();
    if (total <= maxTicks) {
        return new Set(Array.from({ length: total }, (_, i) => i));
    }
    const visible = new Set<number>([0, total - 1]);
    const inner = maxTicks - 2;
    for (let i = 1; i <= inner; i += 1) {
        visible.add(Math.round((i * (total - 1)) / (maxTicks - 1)));
    }
    return visible;
}

const ManagerDashboardTicketsTrendChart: React.FC<Props> = ({ data }) => {
    const labels = useMemo(
        () => data.map((point) => formatEventDateForDisplay(point.date) || point.date),
        [data],
    );
    const visibleTicks = useMemo(() => pickVisibleTickIndices(labels.length, 8), [labels.length]);

    const chartData = {
        labels,
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
                    title(items) {
                        const idx = items[0]?.dataIndex ?? 0;
                        return labels[idx] ?? '';
                    },
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
                    autoSkip: false,
                    callback(_value, index) {
                        return visibleTicks.has(index) ? labels[index] : '';
                    },
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

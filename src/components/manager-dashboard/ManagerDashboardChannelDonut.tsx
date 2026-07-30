import React from 'react';
import { Doughnut } from 'react-chartjs-2';
import { ArcElement, Chart as ChartJS, Legend, Tooltip } from 'chart.js';
import type { ChartOptions } from 'chart.js';
import type { DashboardChannelSlice } from '@/hooks/use-manager-dashboard-charts';

ChartJS.register(ArcElement, Tooltip, Legend);

const COLORS: Record<string, string> = {
    online: '#22d3ee',
    pos: '#818cf8',
    partners: '#34d399',
};

type Props = {
    data: DashboardChannelSlice[];
};

const ManagerDashboardChannelDonut: React.FC<Props> = ({ data }) => {
    const chartData = {
        labels: data.map((s) => s.label),
        datasets: [
            {
                data: data.map((s) => s.amount),
                backgroundColor: data.map((s) => COLORS[s.channel] ?? '#64748b'),
                borderColor: '#000000',
                borderWidth: 2,
                hoverOffset: 6,
            },
        ],
    };

    const options: ChartOptions<'doughnut'> = {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
            legend: {
                position: 'bottom',
                labels: {
                    color: '#cbd5e1',
                    boxWidth: 10,
                    padding: 14,
                    usePointStyle: true,
                    pointStyle: 'circle',
                    generateLabels(chart) {
                        const ds = chart.data.datasets[0];
                        const labels = chart.data.labels ?? [];
                        return labels.map((label, i) => {
                            const amount = Number((ds.data as number[])[i] ?? 0);
                            const pct = data[i]?.percent ?? 0;
                            return {
                                text: `${String(label)} ${pct.toFixed(0)}%`,
                                fillStyle: Array.isArray(ds.backgroundColor)
                                    ? String(ds.backgroundColor[i])
                                    : String(ds.backgroundColor),
                                strokeStyle: '#000',
                                lineWidth: 0,
                                hidden: false,
                                index: i,
                                datasetIndex: 0,
                                fontColor: '#cbd5e1',
                            };
                        });
                    },
                },
            },
            tooltip: {
                callbacks: {
                    label(ctx) {
                        const amount = Number(ctx.parsed ?? 0);
                        const pct = data[ctx.dataIndex]?.percent ?? 0;
                        return ` ${amount.toLocaleString('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                        })} (${pct.toFixed(1)}%)`;
                    },
                },
            },
        },
    };

    return <Doughnut data={chartData} options={options} />;
};

export default ManagerDashboardChannelDonut;

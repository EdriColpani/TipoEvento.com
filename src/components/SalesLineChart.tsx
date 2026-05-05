import React from 'react';
import { Line } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
} from 'chart.js';
import type { ChartOptions } from 'chart.js';
import { formatEventDateForDisplay } from '@/utils/format-event-date';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend
);

/** Paleta EventFest (linha / área sob a curva) */
const LINE = '#22d3ee'; /* cyan-400 */
const LINE_SOFT = 'rgba(34, 211, 238, 0.18)';
const POINT_BORDER = '#0ea5e9'; /* sky-500 */
const TICK_COLOR = '#cbd5e1';

interface SalesDataPoint {
    date: string;
    total_sales: number;
}

interface SalesLineChartProps {
    data: SalesDataPoint[];
    /** Texto da legenda da série (ex.: receita mensal vs. faturamento diário) */
    datasetLabel?: string;
    /** Se definido, exibe título dentro do gráfico; senão o cartão pai pode ser o único título */
    chartInnerTitle?: string | null;
}

const SalesLineChart: React.FC<SalesLineChartProps> = ({
    data,
    datasetLabel = 'Receita mensal',
    chartInnerTitle,
}) => {
    const chartData = {
        labels: data.map((point) => formatEventDateForDisplay(point.date) || point.date),
        datasets: [
            {
                label: datasetLabel,
                data: data.map((point) => point.total_sales),
                borderColor: LINE,
                backgroundColor: LINE_SOFT,
                tension: 0.3,
                fill: true,
                pointRadius: 4,
                pointHoverRadius: 6,
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
            legend: {
                labels: {
                    color: TICK_COLOR,
                    usePointStyle: true,
                    pointStyle: 'circle',
                },
            },
            title: {
                display: Boolean(chartInnerTitle),
                text: chartInnerTitle ?? '',
                color: TICK_COLOR,
                font: { size: 13, weight: '500' },
            },
        },
        scales: {
            x: {
                grid: {
                    color: 'rgba(255, 255, 255, 0.08)',
                },
                ticks: {
                    color: TICK_COLOR,
                    maxRotation: 45,
                    minRotation: 0,
                },
            },
            y: {
                grid: {
                    color: 'rgba(255, 255, 255, 0.08)',
                },
                ticks: {
                    color: TICK_COLOR,
                    callback(value) {
                        const v = typeof value === 'number' ? value : Number(value);
                        return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                    },
                },
            },
        },
    };

    return <Line data={chartData} options={options} />;
};

export default SalesLineChart;

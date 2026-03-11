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

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend
);

interface SalesDataPoint {
    date: string;
    total_sales: number;
}

interface SalesLineChartProps {
    data: SalesDataPoint[];
}

const SalesLineChart: React.FC<SalesLineChartProps> = ({ data }) => {
    const chartData = {
        labels: data.map(point => new Date(point.date).toLocaleDateString('pt-BR')),
        datasets: [
            {
                label: 'Faturamento Diário',
                data: data.map(point => point.total_sales),
                borderColor: 'rgb(250, 204, 21)', // Tailwind yellow-400/500
                backgroundColor: 'rgba(250, 204, 21, 0.2)',
                tension: 0.3,
                fill: true,
                pointRadius: 4,
                pointBackgroundColor: 'rgb(250, 204, 21)',
            },
        ],
    };

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                labels: {
                    color: '#cbd5e1', // gray-300
                },
            },
            title: {
                display: true,
                text: 'Faturamento Mensal',
                color: '#cbd5e1', // gray-300
            },
        },
        scales: {
            x: {
                grid: {
                    color: 'rgba(255, 255, 255, 0.1)',
                },
                ticks: {
                    color: '#cbd5e1', // gray-300
                },
            },
            y: {
                grid: {
                    color: 'rgba(255, 255, 255, 0.1)',
                },
                ticks: {
                    color: '#cbd5e1', // gray-300
                    callback: function(value: any) {
                        return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                    }
                },
            },
        },
    };

    return <Line data={chartData} options={options} />;
};

export default SalesLineChart;


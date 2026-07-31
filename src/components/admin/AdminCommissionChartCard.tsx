import React from 'react';
import { Line } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Tooltip,
    Legend,
} from 'chart.js';
import type { ChartOptions } from 'chart.js';
import { BarChart3 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAdminCommissionSeries } from '@/hooks/use-admin-commission-series';
import { formatEventDateForDisplay } from '@/utils/format-event-date';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

const TICK_COLOR = '#cbd5e1';
const SERIES = [
    { key: 'ticket_commission', label: 'Comissão sobre ingressos', color: '#22d3ee' },
    { key: 'consumption_event_commission', label: 'Comissão consumo (eventos)', color: '#facc15' },
    { key: 'consumption_partner_commission', label: 'Comissão consumo (parceiras)', color: '#a78bfa' },
] as const;

function money(value: number): string {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const SummaryItem: React.FC<{ label: string; value: number; color?: string }> = ({
    label,
    value,
    color,
}) => (
    <div className="flex flex-col">
        <span className="text-xs text-gray-400">{label}</span>
        <span className="text-lg font-semibold" style={{ color: color ?? '#ffffff' }}>
            {money(value)}
        </span>
    </div>
);

const AdminCommissionChartCard: React.FC<{ enabled: boolean }> = ({ enabled }) => {
    const { items, summary, isLoading, isError } = useAdminCommissionSeries(enabled);

    if (!enabled) return null;

    const hasData = items.some((point) => point.total_commission > 0);

    const chartData = {
        labels: items.map((point) => formatEventDateForDisplay(point.bucket_date) || point.bucket_date),
        datasets: SERIES.map((serie) => ({
            label: serie.label,
            data: items.map((point) => point[serie.key]),
            borderColor: serie.color,
            backgroundColor: serie.color,
            tension: 0.3,
            fill: false,
            pointRadius: 3,
            pointHoverRadius: 6,
        })),
    };

    const options: ChartOptions<'line'> = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: {
                labels: { color: TICK_COLOR, usePointStyle: true, pointStyle: 'circle' },
            },
            tooltip: {
                callbacks: {
                    label: (ctx) => `${ctx.dataset.label}: ${money(Number(ctx.parsed.y ?? 0))}`,
                },
            },
        },
        scales: {
            x: {
                grid: { color: 'rgba(255, 255, 255, 0.08)' },
                ticks: { color: TICK_COLOR, maxRotation: 45, minRotation: 0 },
            },
            y: {
                grid: { color: 'rgba(255, 255, 255, 0.08)' },
                ticks: {
                    color: TICK_COLOR,
                    callback: (value) => money(typeof value === 'number' ? value : Number(value)),
                },
            },
        },
    };

    return (
        <Card className="bg-black border border-yellow-500/30 rounded-2xl p-6">
            <CardHeader className="p-0 mb-4">
                <CardTitle className="text-white text-xl flex items-center">
                    <BarChart3 className="h-5 w-5 mr-2 text-yellow-500" />
                    Lançamentos de comissão (30 dias)
                </CardTitle>
                <CardDescription className="text-gray-400 text-sm">
                    Comissão da EventFest sobre ingressos vendidos e sobre consumo de créditos, em eventos e
                    em empresas parceiras. Exclui splits revertidos por chargeback.
                </CardDescription>
            </CardHeader>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
                <SummaryItem label="Total no período" value={summary.total_commission} color="#ffffff" />
                {SERIES.map((serie) => (
                    <SummaryItem
                        key={serie.key}
                        label={serie.label}
                        value={summary[serie.key]}
                        color={serie.color}
                    />
                ))}
            </div>

            <CardContent className="p-0 h-72 bg-black/40 rounded-xl flex items-center justify-center">
                {isLoading ? (
                    <div className="text-center">
                        <BarChart3 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-2" />
                        <p className="text-gray-400">Carregando lançamentos de comissão...</p>
                    </div>
                ) : isError ? (
                    <p className="text-red-400 text-sm">Não foi possível carregar as comissões.</p>
                ) : hasData ? (
                    <div className="relative w-full h-full p-4">
                        <Line data={chartData} options={options} />
                    </div>
                ) : (
                    <div className="text-center">
                        <BarChart3 className="h-8 w-8 text-gray-500 mx-auto mb-2" />
                        <p className="text-gray-400">Nenhum lançamento de comissão nos últimos 30 dias.</p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

export default AdminCommissionChartCard;

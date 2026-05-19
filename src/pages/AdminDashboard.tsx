import React, { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Users, Building, Zap, Clock, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { formatEventDateForDisplay } from '@/utils/format-event-date';
import { EMPTY_ADMIN_METRICS, useAdminDashboardStats } from '@/hooks/use-admin-dashboard-stats';
import { showError } from '@/utils/toast';

const getActivityStatusClasses = (status: string) => {
    switch (status) {
        case 'success': return 'text-green-500 bg-green-500/20';
        case 'warning': return 'text-yellow-500 bg-yellow-500/20';
        case 'error': return 'text-red-500 bg-red-500/20';
        case 'info':
        default: return 'text-blue-500 bg-blue-500/20';
    }
};

const AdminDashboard: React.FC = () => {
    const navigate = useNavigate();
    const { data, isLoading, isError, error } = useAdminDashboardStats(true);

    useEffect(() => {
        if (isError && error) {
            showError('Não foi possível carregar todas as métricas do dashboard.');
        }
    }, [isError, error]);

    const metrics = data?.metrics ?? EMPTY_ADMIN_METRICS;
    const recentActivity = data?.recentActivity ?? [];
    const apiLatencyMs = data?.apiLatencyMs ?? 0;

    const platformHealth = useMemo(() => {
        const totalProfiles = Math.max(metrics.total_profiles, 1);
        const totalEvents = Math.max(metrics.total_events, 1);
        const latencyBar = Math.min((apiLatencyMs / 400) * 100, 100);
        const activePct = Math.round((metrics.active_events / totalEvents) * 100);
        const clientsPct = Math.round((metrics.client_profiles / totalProfiles) * 100);
        return [
            { name: 'API Latência (ms)', value: apiLatencyMs, threshold: 200, unit: 'ms', widthPct: latencyBar },
            { name: 'Eventos ativos (%)', value: activePct, threshold: 35, unit: '%', widthPct: Math.min(activePct, 100) },
            { name: 'Clientes / usuários (%)', value: clientsPct, threshold: 30, unit: '%', widthPct: Math.min(clientsPct, 100) },
        ];
    }, [metrics, apiLatencyMs]);

    const latencyAlerts = apiLatencyMs >= 200 ? 1 : 0;

    if (isLoading && !data) {
        return (
            <div className="max-w-7xl mx-auto flex flex-col items-center justify-center py-24 text-gray-400">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mb-4" />
                <p>Carregando métricas do dashboard...</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto">
            <div className="mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 mb-2 flex items-center">
                    <i className="fas fa-user-shield mr-3"></i>
                    Dashboard Admin Master
                </h1>
                <p className="text-gray-400 text-sm sm:text-base">Visão geral e gerenciamento da saúde da plataforma EventFest.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <div className="bg-black border border-yellow-500/30 rounded-2xl p-6 hover:border-yellow-500/60 transition-all duration-300">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-500/20 rounded-xl flex items-center justify-center">
                            <Users className="text-blue-500 h-5 w-5" />
                        </div>
                        <div className="text-right">
                            <div className="text-green-500 text-sm font-semibold">
                                +{metrics.profiles_this_month}
                            </div>
                            <div className="text-gray-400 text-xs">novos este mês</div>
                        </div>
                    </div>
                    <div>
                        <div className="text-xl sm:text-2xl font-bold text-white mb-1">
                            {metrics.total_profiles.toLocaleString('pt-BR')}
                        </div>
                        <div className="text-gray-400 text-sm">Total de Usuários</div>
                    </div>
                </div>

                <div className="bg-black border border-yellow-500/30 rounded-2xl p-6 hover:border-yellow-500/60 transition-all duration-300">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-purple-500/20 rounded-xl flex items-center justify-center">
                            <Building className="text-purple-500 h-5 w-5" />
                        </div>
                        <div className="text-right">
                            <div className="text-purple-500 text-sm font-semibold">
                                +{metrics.companies_this_month}
                            </div>
                            <div className="text-gray-400 text-xs">novas empresas</div>
                        </div>
                    </div>
                    <div>
                        <div className="text-xl sm:text-2xl font-bold text-white mb-1">
                            {metrics.total_companies.toLocaleString('pt-BR')}
                        </div>
                        <div className="text-gray-400 text-sm">
                            Empresas cadastradas <span className="text-gray-500">·</span>{' '}
                            <span className="text-purple-400">{metrics.manager_profiles}</span> gestores PRO
                        </div>
                    </div>
                </div>

                <div className="bg-black border border-yellow-500/30 rounded-2xl p-6 hover:border-yellow-500/60 transition-all duration-300">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-green-500/20 rounded-xl flex items-center justify-center">
                            <Zap className="text-green-500 h-5 w-5" />
                        </div>
                        <div className="text-right">
                            <div className="text-green-500 text-sm font-semibold">{metrics.active_events}</div>
                            <div className="text-gray-400 text-xs">ativos</div>
                        </div>
                    </div>
                    <div>
                        <div className="text-xl sm:text-2xl font-bold text-white mb-1">
                            {metrics.total_events.toLocaleString('pt-BR')}
                        </div>
                        <div className="text-gray-400 text-sm">
                            Eventos · +{metrics.events_this_month} novos este mês
                        </div>
                    </div>
                </div>

                <div className="bg-black border border-yellow-500/30 rounded-2xl p-6 hover:border-yellow-500/60 transition-all duration-300">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-red-500/20 rounded-xl flex items-center justify-center">
                            <AlertTriangle className="text-red-500 h-5 w-5" />
                        </div>
                        <div className="text-right">
                            <div className={`text-sm font-semibold ${latencyAlerts ? 'text-red-400' : 'text-green-500'}`}>
                                {latencyAlerts ? `${latencyAlerts} alerta` : 'OK'}
                            </div>
                            <div className="text-gray-400 text-xs">{latencyAlerts ? 'latência alta' : 'resposta normal'}</div>
                        </div>
                    </div>
                    <div>
                        <div className="text-xl sm:text-2xl font-bold text-white mb-1">{apiLatencyMs}ms</div>
                        <div className="text-gray-400 text-sm">Latência média (consulta API)</div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 bg-black border border-yellow-500/30 rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg sm:text-xl font-semibold text-white flex items-center">
                            <Clock className="h-5 w-5 mr-2 text-yellow-500" />
                            Atividade recente
                        </h3>
                        <Button
                            type="button"
                            variant="outline"
                            className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30 hover:bg-yellow-500/30 text-xs sm:text-sm cursor-pointer px-3 py-1"
                            onClick={() => navigate('/manager/events')}
                        >
                            Ver eventos
                        </Button>
                    </div>
                    <div className="space-y-4 max-h-[400px] overflow-y-auto">
                        {recentActivity.length === 0 ? (
                            <p className="text-gray-500 text-sm py-6 text-center">Nenhuma atividade recente com data disponível.</p>
                        ) : (
                            recentActivity.map((activity) => (
                                <div key={activity.id} className="flex items-center justify-between p-3 bg-black/40 rounded-xl border border-yellow-500/10">
                                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                                        <span className={`w-2 h-2 rounded-full shrink-0 ${getActivityStatusClasses(activity.status)}`}></span>
                                        <div className="min-w-0">
                                            <div className="text-white font-medium text-sm truncate">{activity.type}</div>
                                            <div className="text-gray-400 text-xs truncate">{activity.detail}</div>
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0 ml-4">
                                        <div className="text-gray-500 text-xs">{formatEventDateForDisplay(activity.date) || '—'}</div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className="lg:col-span-1 bg-black border border-yellow-500/30 rounded-2xl p-6">
                    <h3 className="text-lg sm:text-xl font-semibold text-white mb-6 flex items-center">
                        <CheckCircle className="h-5 w-5 mr-2 text-green-500" />
                        Saúde da Plataforma
                    </h3>
                    <div className="space-y-6">
                        {platformHealth.map((metric) => {
                            const isLatency = metric.name.includes('Latência');
                            const isBad =
                                isLatency ? metric.value > metric.threshold : metric.value < metric.threshold;
                            return (
                                <div key={metric.name}>
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-gray-400 text-sm">{metric.name}</span>
                                        <span className="text-white font-semibold">
                                            {metric.value}
                                            {metric.unit}
                                        </span>
                                    </div>
                                    <div className="w-full bg-black/40 rounded-full h-2">
                                        <div
                                            className={`h-2 rounded-full transition-all duration-500 ${
                                                isBad ? 'bg-red-500' : 'bg-yellow-500'
                                            }`}
                                            style={{ width: `${metric.widthPct}%` }}
                                        ></div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="mt-8 space-y-4">
                        <Button
                            type="button"
                            onClick={() => navigate('/manager/settings/advanced')}
                            className="w-full bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 py-3 transition-all duration-300 cursor-pointer flex items-center justify-center text-sm sm:text-base"
                        >
                            <i className="fas fa-cog mr-2"></i>
                            Gerenciar Configurações
                        </Button>
                        <Button
                            type="button"
                            onClick={() => alert('Simulando reinício de serviços...')}
                            className="w-full bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 py-3 transition-all duration-300 cursor-pointer flex items-center justify-center text-sm sm:text-base"
                        >
                            <i className="fas fa-sync-alt mr-2"></i>
                            Reiniciar Serviços Críticos
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminDashboard;

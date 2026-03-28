import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { adminStats } from '@/data/admin';
import { Users, Building, Zap, Clock, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { formatEventDateForDisplay } from '@/utils/format-event-date';

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

    return (
        <div className="max-w-7xl mx-auto">
            <div className="mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 mb-2 flex items-center">
                    <i className="fas fa-user-shield mr-3"></i>
                    Dashboard Admin Master
                </h1>
                <p className="text-gray-400 text-sm sm:text-base">Visão geral e gerenciamento da saúde da plataforma EventoFest.</p>
            </div>

            {/* Cartões de Estatísticas Globais */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <div className="bg-black border border-yellow-500/30 rounded-2xl p-6 hover:border-yellow-500/60 transition-all duration-300">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-500/20 rounded-xl flex items-center justify-center">
                            <Users className="text-blue-500 h-5 w-5" />
                        </div>
                        <div className="text-right">
                            <div className="text-green-500 text-sm font-semibold">+{adminStats.monthlyRegistrations}</div>
                            <div className="text-gray-400 text-xs">novos este mês</div>
                        </div>
                    </div>
                    <div>
                        <div className="text-xl sm:text-2xl font-bold text-white mb-1">{adminStats.totalUsers.toLocaleString()}</div>
                        <div className="text-gray-400 text-sm">Total de Usuários</div>
                    </div>
                </div>

                <div className="bg-black border border-yellow-500/30 rounded-2xl p-6 hover:border-yellow-500/60 transition-all duration-300">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-purple-500/20 rounded-xl flex items-center justify-center">
                            <Building className="text-purple-500 h-5 w-5" />
                        </div>
                        <div className="text-right">
                            <div className="text-purple-500 text-sm font-semibold">+5</div>
                            <div className="text-gray-400 text-xs">novas empresas</div>
                        </div>
                    </div>
                    <div>
                        <div className="text-xl sm:text-2xl font-bold text-white mb-1">{adminStats.totalManagers.toLocaleString()}</div>
                        <div className="text-gray-400 text-sm">Empresas/Gestores</div>
                    </div>
                </div>

                <div className="bg-black border border-yellow-500/30 rounded-2xl p-6 hover:border-yellow-500/60 transition-all duration-300">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-green-500/20 rounded-xl flex items-center justify-center">
                            <Zap className="text-green-500 h-5 w-5" />
                        </div>
                        <div className="text-right">
                            <div className="text-green-500 text-sm font-semibold">Status OK</div>
                            <div className="text-gray-400 text-xs">últimas 24h</div>
                        </div>
                    </div>
                    <div>
                        <div className="text-xl sm:text-2xl font-bold text-white mb-1">{adminStats.systemUptime}%</div>
                        <div className="text-gray-400 text-sm">Uptime do Sistema</div>
                    </div>
                </div>

                <div className="bg-black border border-yellow-500/30 rounded-2xl p-6 hover:border-yellow-500/60 transition-all duration-300">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-red-500/20 rounded-xl flex items-center justify-center">
                            <AlertTriangle className="text-red-500 h-5 w-5" />
                        </div>
                        <div className="text-right">
                            <div className="text-red-500 text-sm font-semibold">1</div>
                            <div className="text-gray-400 text-xs">alerta ativo</div>
                        </div>
                    </div>
                    <div>
                        <div className="text-xl sm:text-2xl font-bold text-white mb-1">45ms</div>
                        <div className="text-gray-400 text-sm">Latência Média API</div>
                    </div>
                </div>
            </div>

            {/* Saúde da Plataforma e Atividade Recente */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                
                {/* Atividade Recente */}
                <div className="lg:col-span-2 bg-black border border-yellow-500/30 rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg sm:text-xl font-semibold text-white flex items-center">
                            <Clock className="h-5 w-5 mr-2 text-yellow-500" />
                            Log de Atividade Recente
                        </h3>
                        <Button className="bg-yellow-500/20 text-yellow-500 hover:bg-yellow-500/30 text-xs sm:text-sm cursor-pointer px-3 py-1">
                            Ver Tudo
                        </Button>
                    </div>
                    <div className="space-y-4 max-h-[400px] overflow-y-auto">
                        {adminStats.recentActivity.map((activity) => (
                            <div key={activity.id} className="flex items-center justify-between p-3 bg-black/40 rounded-xl border border-yellow-500/10">
                                <div className="flex items-center space-x-3 flex-1 min-w-0">
                                    <span className={`w-2 h-2 rounded-full ${getActivityStatusClasses(activity.status)}`}></span>
                                    <div className="min-w-0">
                                        <div className="text-white font-medium text-sm truncate">{activity.type}</div>
                                        <div className="text-gray-400 text-xs truncate">{activity.detail}</div>
                                    </div>
                                </div>
                                <div className="text-right flex-shrink-0 ml-4">
                                    <div className="text-gray-500 text-xs">{formatEventDateForDisplay(activity.date) || '—'}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Saúde da Plataforma */}
                <div className="lg:col-span-1 bg-black border border-yellow-500/30 rounded-2xl p-6">
                    <h3 className="text-lg sm:text-xl font-semibold text-white mb-6 flex items-center">
                        <CheckCircle className="h-5 w-5 mr-2 text-green-500" />
                        Saúde da Plataforma
                    </h3>
                    <div className="space-y-6">
                        {adminStats.platformHealth.map((metric, index) => (
                            <div key={index}>
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-gray-400 text-sm">{metric.name}</span>
                                    <span className="text-white font-semibold">{metric.value}{metric.unit}</span>
                                </div>
                                <div className="w-full bg-black/40 rounded-full h-2">
                                    <div
                                        className={`h-2 rounded-full transition-all duration-500 ${metric.value > metric.threshold ? 'bg-red-500' : 'bg-yellow-500'}`}
                                        style={{ width: `${Math.min(metric.value, 100)}%` }}
                                    ></div>
                                </div>
                            </div>
                        ))}
                    </div>
                    
                    <div className="mt-8 space-y-4">
                        <Button 
                            onClick={() => navigate('/manager/settings/advanced')}
                            className="w-full bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 py-3 transition-all duration-300 cursor-pointer flex items-center justify-center text-sm sm:text-base"
                        >
                            <i className="fas fa-cog mr-2"></i>
                            Gerenciar Configurações
                        </Button>
                        <Button 
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
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useState } from 'react';
import { Plus, QrCode, BarChart3, Download, Settings, ChevronDown, DollarSign, Users, CalendarCheck, TrendingUp, Ticket, AreaChart } from 'lucide-react';
import { useDashboardData } from '@/hooks/use-dashboard-data';
import { useMonthlyRevenueData } from '@/hooks/use-monthly-revenue-data';
import { Loader2 } from 'lucide-react';
import SalesLineChart from '@/components/SalesLineChart';
import { useTopSellingEvents } from '@/hooks/use-top-selling-events';
import { useRecentSales } from '@/hooks/use-recent-sales';
import { useProfile } from '@/hooks/use-profile';
import { supabase } from '@/integrations/supabase/client';

const ManagerDashboard: React.FC = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState<string | undefined>(undefined);
    React.useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id));
    }, []);
    const { profile, isLoading: isLoadingProfile } = useProfile(userId);
    const isAdminMaster = profile?.tipo_usuario_id === 1;
    const { data: dashboardData, isLoading, isError } = useDashboardData(userId, isAdminMaster || false);
    const [monthlyRevenuePeriod, setMonthlyRevenuePeriod] = useState(6);
    const { data: monthlyRevenueData, isLoading: isLoadingMonthlyRevenue, isError: isErrorMonthlyRevenue } = useMonthlyRevenueData(monthlyRevenuePeriod, userId, isAdminMaster || false);
    const { data: topSellingEvents, isLoading: isLoadingTopSellingEvents, isError: isErrorTopSellingEvents } = useTopSellingEvents(5, userId, isAdminMaster || false); // Limite de 5 eventos
    const { data: recentSales, isLoading: isLoadingRecentSales, isError: isErrorRecentSales } = useRecentSales(5, userId, isAdminMaster || false); // Limite de 5 vendas recentes

    return (
        <div className="max-w-7xl mx-auto">
            <div className="mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-white mb-2">Bem-vindo ao Dashboard PRO</h1>
                <p className="text-gray-400 text-sm sm:text-base">Gerencie seus eventos com ferramentas premium e analytics avançados</p>
            </div>

            {/* Cartões de Estatísticas */}
            {(isLoadingProfile || isLoading) && (
                <div className="text-center py-20">
                    <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                    <p className="text-gray-400">Carregando dados do dashboard...</p>
                </div>
            )}

            {isError && (
                <div className="text-center py-20">
                    <p className="text-red-500">Erro ao carregar os dados do dashboard. Tente novamente mais tarde.</p>
                </div>
            )}

            {!isLoadingProfile && !isLoading && !isError && dashboardData && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    {/* Cartão de Vendas Totais */}
                    <div className="bg-black border border-yellow-500/30 rounded-2xl p-6 hover:border-yellow-500/60 transition-all duration-300">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-green-500/20 rounded-xl flex items-center justify-center">
                                <DollarSign className="text-green-500 text-lg sm:text-xl" />
                            </div>
                            <div className="text-right">
                                <div className={`text-sm font-semibold ${dashboardData.sales.salesPercentageChange >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                    {dashboardData.sales.salesPercentageChange >= 0 ? '+' : ''}{dashboardData.sales.salesPercentageChange.toFixed(1)}%
                                </div>
                                <div className="text-gray-400 text-xs">vs 30 dias anteriores</div>
                            </div>
                        </div>
                        <div>
                            <div className="text-xl sm:text-2xl font-bold text-white mb-1">{dashboardData.sales.currentMonthTotalSales.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div>
                            <div className="text-gray-400 text-sm">Vendas Totais</div>
                        </div>
                    </div>

                    {/* Cartão de Ingressos Vendidos */}
                    <div className="bg-black border border-yellow-500/30 rounded-2xl p-6 hover:border-yellow-500/60 transition-all duration-300">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-500/20 rounded-xl flex items-center justify-center">
                                <Ticket className="text-blue-500 text-lg sm:text-xl" />
                            </div>
                            <div className="text-right">
                                <div className={`text-sm font-semibold ${dashboardData.sales.ticketsPercentageChange >= 0 ? 'text-blue-500' : 'text-red-500'}`}>
                                    {dashboardData.sales.ticketsPercentageChange >= 0 ? '+' : ''}{dashboardData.sales.ticketsPercentageChange.toFixed(1)}%
                                </div>
                                <div className="text-gray-400 text-xs">vs 30 dias anteriores</div>
                            </div>
                        </div>
                        <div>
                            <div className="text-xl sm:text-2xl font-bold text-white mb-1">{dashboardData.sales.currentMonthTicketsSold.toLocaleString()}</div>
                            <div className="text-gray-400 text-sm">Ingressos Vendidos</div>
                        </div>
                    </div>

                    {/* Cartão de Eventos Ativos */}
                    <div className="bg-black border border-yellow-500/30 rounded-2xl p-6 hover:border-yellow-500/60 transition-all duration-300">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-yellow-500/20 rounded-xl flex items-center justify-center">
                                <CalendarCheck className="text-yellow-500 text-lg sm:text-xl" />
                            </div>
                            <div className="text-right">
                                <div className="text-yellow-500 text-sm font-semibold">{dashboardData.events.activeEvents}/{dashboardData.events.totalEvents}</div>
                                <div className="text-gray-400 text-xs">ativos/total</div>
                            </div>
                        </div>
                        <div>
                            <div className="text-xl sm:text-2xl font-bold text-white mb-1">{dashboardData.events.activeEvents}</div>
                            <div className="text-gray-400 text-sm">Eventos Ativos</div>
                        </div>
                    </div>

                    {/* Cartão de Taxa de Ocupação */}
                    <div className="bg-black border border-yellow-500/30 rounded-2xl p-6 hover:border-yellow-500/60 transition-all duration-300">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-purple-500/20 rounded-xl flex items-center justify-center">
                                <Users className="text-purple-500 text-lg sm:text-xl" />
                            </div>
                            <div className="text-right">
                                <div className="text-purple-500 text-sm font-semibold">Excelente</div>
                                <div className="text-gray-400 text-xs">performance</div>
                            </div>
                        </div>
                        <div>
                            <div className="text-xl sm:text-2xl font-bold text-white mb-1">{dashboardData.occupancy.occupancyRate.toFixed(1)}%</div>
                            <div className="text-gray-400 text-sm">Taxa de Ocupação</div>
                        </div>
                    </div>
                </div>
            )}

            {/* Gráficos e Top Eventos */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                <div className="bg-black border border-yellow-500/30 rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg sm:text-xl font-semibold text-white">Receita Mensal</h3>
                        <div className="flex items-center space-x-4">
                            <select 
                                className="bg-black/60 border border-yellow-500/30 rounded-lg px-3 py-1 text-white text-sm focus:outline-none cursor-pointer"
                                value={monthlyRevenuePeriod}
                                onChange={(e) => setMonthlyRevenuePeriod(Number(e.target.value))}
                            >
                                <option value={6}>Últimos 6 meses</option>
                                <option value={12}>Último ano</option>
                            </select>
                        </div>
                    </div>
                    <div className="h-64 bg-black/40 rounded-xl flex items-center justify-center">
                        {isLoadingMonthlyRevenue ? (
                            <div className="text-center">
                                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                                <p className="text-gray-400">Carregando gráfico de receita...</p>
                            </div>
                        ) : isErrorMonthlyRevenue ? (
                            <div className="text-center">
                                <p className="text-red-500">Erro ao carregar o gráfico de receita.</p>
                            </div>
                        ) : (monthlyRevenueData && monthlyRevenueData.length > 0) ? (
                            <div className="relative w-full h-full p-4">
                                <SalesLineChart 
                                    data={monthlyRevenueData.map(item => ({ date: item.month, total_sales: item.total_revenue }))}
                                />
                            </div>
                        ) : (
                            <div className="text-center">
                                <AreaChart className="text-gray-500 text-4xl mb-4" />
                                <p className="text-gray-400">Nenhum dado de receita disponível.</p>
                            </div>
                        )}
                    </div>
                </div>

                <div className="bg-black border border-yellow-500/30 rounded-2xl p-6">
                    <h3 className="text-lg sm:text-xl font-semibold text-white mb-6">Eventos Mais Vendidos</h3>
                    {isLoadingTopSellingEvents ? (
                        <div className="text-center py-4">
                            <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-2" />
                            <p className="text-gray-400">Carregando eventos...</p>
                        </div>
                    ) : isErrorTopSellingEvents ? (
                        <div className="text-center py-4">
                            <p className="text-red-500">Erro ao carregar eventos mais vendidos.</p>
                        </div>
                    ) : (topSellingEvents && topSellingEvents.length > 0) ? (
                        <div className="space-y-4 overflow-y-auto max-h-64 pr-2">
                            {topSellingEvents.map((event, index) => (
                                <div key={index} className="flex items-center justify-between p-4 bg-black/40 rounded-xl">
                                    <div className="flex-1 min-w-0">
                                        <div className="text-white font-semibold mb-1 text-sm sm:text-base truncate">{event.event_title}</div>
                                        <div className="flex items-center space-x-4 text-xs sm:text-sm">
                                            <span className="text-gray-400 flex-shrink-0">{event.total_tickets_sold}/{event.total_wristbands_generated} vendidos</span>
                                            <div className="flex-1 bg-black/60 rounded-full h-2 max-w-[100px] hidden sm:block">
                                                <div
                                                    className="bg-yellow-500 h-2 rounded-full transition-all duration-300"
                                                    style={{ width: `${(event.total_tickets_sold / event.total_wristbands_generated) * 100 || 0}%` }}
                                                ></div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right flex-shrink-0 ml-4">
                                        <div className="text-yellow-500 font-semibold text-sm sm:text-base">{event.total_revenue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div>
                                        <div className="text-gray-400 text-xs">{((event.total_tickets_sold / event.total_wristbands_generated) * 100 || 0).toFixed(0)}%</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-4">
                            <TrendingUp className="h-8 w-8 text-gray-500 mx-auto mb-2" />
                            <p className="text-gray-400">Nenhum evento vendido ainda.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Vendas Recentes e Ações Rápidas */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 bg-black border border-yellow-500/30 rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg sm:text-xl font-semibold text-white">Vendas Recentes</h3>
                        <Button 
                            className="bg-yellow-500/20 text-yellow-500 hover:bg-yellow-500/30 text-xs sm:text-sm cursor-pointer px-3 py-1"
                            onClick={() => navigate('/manager/reports/sales')}
                        >
                            Ver Todas
                        </Button>
                    </div>
                    {isLoadingRecentSales ? (
                        <div className="text-center py-4">
                            <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-2" />
                            <p className="text-gray-400">Carregando vendas recentes...</p>
                        </div>
                    ) : isErrorRecentSales ? (
                        <div className="text-center py-4">
                            <p className="text-red-500">Erro ao carregar vendas recentes.</p>
                        </div>
                    ) : (recentSales && recentSales.length > 0) ? (
                        <div className="overflow-x-auto overflow-y-auto max-h-64 pr-2">
                            <table className="w-full min-w-[600px]">
                                <thead>
                                    <tr className="border-b border-yellow-500/20 text-sm">
                                        <th className="text-left text-gray-400 font-semibold py-3">Evento</th>
                                        <th className="text-center text-gray-400 font-semibold py-3">Ingressos</th>
                                        <th className="text-center text-gray-400 font-semibold py-3">Valor</th>
                                        <th className="text-center text-gray-400 font-semibold py-3">Data</th>
                                        <th className="text-center text-gray-400 font-semibold py-3">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {recentSales.map((sale) => (
                                        <tr key={sale.id} className="border-b border-yellow-500/10 hover:bg-black/40 transition-colors text-sm">
                                            <td className="py-4">
                                                <div className="text-white font-medium truncate max-w-[200px]">{sale.event_title}</div>
                                            </td>
                                            <td className="text-center py-4">
                                                <span className="text-white">{sale.tickets_sold}</span>
                                            </td>
                                            <td className="text-center py-4">
                                                <span className="text-yellow-500 font-semibold">{sale.total_value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                                            </td>
                                            <td className="text-center py-4">
                                                <span className="text-gray-400 text-xs">{sale.sale_date}</span>
                                            </td>
                                            <td className="text-center py-4">
                                                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${sale.status === 'Confirmado'
                                                        ? 'bg-green-500/20 text-green-500'
                                                        : 'bg-yellow-500/20 text-yellow-500'
                                                    }`}>
                                                    {sale.status}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="text-center py-4">
                            <TrendingUp className="h-8 w-8 text-gray-500 mx-auto mb-2" />
                            <p className="text-gray-400">Nenhuma venda recente.</p>
                        </div>
                    )}
                </div>

                <div className="bg-black border border-yellow-500/30 rounded-2xl p-6">
                    <h3 className="text-lg sm:text-xl font-semibold text-white mb-6">Ações Rápidas</h3>
                    
                    {/* Menu Suspenso de Ações Rápidas */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                className="w-full bg-yellow-500 text-black hover:bg-yellow-600 py-3 transition-all duration-300 cursor-pointer flex items-center justify-center text-sm sm:text-base"
                            >
                                <Settings className="mr-2 h-5 w-5" />
                                Ações de Gerenciamento
                                <ChevronDown className="ml-2 h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-full bg-black/90 border border-yellow-500/30 text-white">
                            <DropdownMenuLabel className="text-yellow-500">Gerenciar Eventos e Pulseiras</DropdownMenuLabel>
                            <DropdownMenuSeparator className="bg-yellow-500/20" />
                            <DropdownMenuItem 
                                onClick={() => navigate('/manager/events/create')}
                                className="cursor-pointer hover:bg-yellow-500/10"
                            >
                                <Plus className="mr-2 h-4 w-4" />
                                Criar Novo Evento
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                                onClick={() => navigate('/manager/wristbands/create')}
                                className="cursor-pointer hover:bg-yellow-500/10"
                            >
                                <QrCode className="mr-2 h-4 w-4" />
                                Gerar Pulseiras
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className="bg-yellow-500/20" />
                            <DropdownMenuItem 
                                onClick={() => navigate('/manager/reports')}
                                className="cursor-pointer hover:bg-yellow-500/10"
                            >
                                <BarChart3 className="mr-2 h-4 w-4" />
                                Relatório Completo
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                                onClick={() => alert('Exportando dados...')}
                                className="cursor-pointer hover:bg-yellow-500/10"
                            >
                                <Download className="mr-2 h-4 w-4" />
                                Exportar Dados
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    
                    {/* Status do Sistema (mantido) */}
                    <div className="mt-8 p-4 bg-black/40 rounded-xl">
                        <h4 className="text-white font-semibold mb-4 flex items-center text-base sm:text-lg">
                            <i className="fas fa-server text-yellow-500 mr-2"></i>
                            Status do Sistema
                        </h4>
                        <div className="space-y-3">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-gray-400">Vendas Online</span>
                                <div className="flex items-center">
                                    <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                                    <span className="text-green-500">Ativo</span>
                                </div>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-gray-400">Gateway Pagamento</span>
                                <div className="flex items-center">
                                    <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                                    <span className="text-green-500">Ativo</span>
                                </div>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-gray-400">Sistema Pulseiras</span>
                                <div className="flex items-center">
                                    <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                                    <span className="text-green-500">Ativo</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ManagerDashboard;
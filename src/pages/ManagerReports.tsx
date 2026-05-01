import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowLeft, BarChart3, FileText, TrendingUp, Users, DollarSign, ClipboardList, Activity } from 'lucide-react';
import { useProfile } from '@/hooks/use-profile';
import { supabase } from '@/integrations/supabase/client';
import { useState, useEffect } from 'react';
import { useSalesChartData } from '@/hooks/use-sales-chart-data';
import SalesLineChart from '@/components/SalesLineChart';
import { format } from 'date-fns';

const ReportCard: React.FC<{ icon: React.ReactNode, title: string, description: string, onClick: () => void }> = ({ icon, title, description, onClick }) => (
    <Card 
        className="bg-black border border-yellow-500/30 rounded-2xl p-6 hover:border-yellow-500/60 hover:shadow-2xl hover:shadow-yellow-500/20 transition-all duration-300 cursor-pointer"
        onClick={onClick}
    >
        <CardHeader className="p-0 mb-4">
            <div className="flex items-center space-x-4">
                <div className="w-12 h-12 bg-yellow-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
                    {icon}
                </div>
                <CardTitle className="text-white text-xl">{title}</CardTitle>
            </div>
        </CardHeader>
        <CardContent className="p-0">
            <CardDescription className="text-gray-400 text-sm">
                {description}
            </CardDescription>
        </CardContent>
    </Card>
);

const ManagerReports: React.FC = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState<string | undefined>(undefined);
    
    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
            setUserId(user?.id);
        });
    }, []);

    const { profile } = useProfile(userId);
    const isAdminMaster = profile?.tipo_usuario_id === 1;
    const { data: salesData, isLoading: isLoadingSalesData } = useSalesChartData(userId, isAdminMaster || false);
    const isManagerPro = profile?.tipo_usuario_id === 2;
    const canAccessFinancialReport = isAdminMaster || isManagerPro;

    const handleReportClick = (reportName: string) => {
        alert(`Gerando relatório: ${reportName}`);
        // Aqui seria a lógica para navegar para um relatório específico ou gerar um PDF
    };

    return (
        <div className="max-w-7xl mx-auto">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center">
                    <BarChart3 className="h-7 w-7 mr-3" />
                    Central de Relatórios
                </h1>
                <Button 
                    onClick={() => navigate('/manager/dashboard')}
                    variant="outline"
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 text-sm"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar ao Dashboard
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
                {canAccessFinancialReport && (
                    <ReportCard
                        icon={<DollarSign className="h-6 w-6 text-yellow-500" />}
                        title="Relatório Financeiro"
                        description="Valores vendidos, comissões do sistema e valores líquidos dos organizadores por evento."
                        onClick={() => navigate('/manager/reports/financial')}
                    />
                )}
                <ReportCard
                    icon={<TrendingUp className="h-6 w-6 text-yellow-500" />}
                    title="Relatório de Vendas"
                    description="Análise detalhada de receita, ingressos vendidos e performance por evento."
                    onClick={() => navigate('/manager/reports/sales')}
                />
                <ReportCard
                    icon={<FileText className="h-6 w-6 text-yellow-500" />}
                    title="Relatório de Eventos"
                    description="Status, ocupação e dados cadastrais de todos os eventos ativos e passados."
                    onClick={() => navigate('/manager/reports/events')}
                />
                <ReportCard
                    icon={<Users className="h-6 w-6 text-yellow-500" />}
                    title="Relatório de Público"
                    description="Dados demográficos e comportamento dos clientes que compraram ingressos."
                    onClick={() => navigate('/manager/reports/audience')}
                />
                <ReportCard
                    icon={<ClipboardList className="h-6 w-6 text-yellow-500" />}
                    title="Relatório de Inscrições"
                    description="Lista de inscritos por evento, com coluna de confirmação para impressão e controle de presença."
                    onClick={() => navigate('/manager/reports/registrations')}
                />
                <ReportCard
                    icon={<Activity className="h-6 w-6 text-yellow-500" />}
                    title="Movimentação de Pulseiras"
                    description="Entradas e saídas por pulseira/ingresso em cada evento, com total de passagens na portaria."
                    onClick={() => navigate('/manager/reports/wristband-movements')}
                />
            </div>
            
            <Card className="bg-black border border-yellow-500/30 rounded-2xl p-6">
                <CardHeader className="p-0 mb-4">
                    <CardTitle className="text-white text-xl flex items-center">
                        <BarChart3 className="h-5 w-5 mr-2 text-yellow-500" />
                        Visualização Rápida
                    </CardTitle>
                    <CardDescription className="text-gray-400 text-sm">
                        Gráfico de vendas dos últimos 30 dias (em desenvolvimento).
                    </CardDescription>
                </CardHeader>
                <CardContent className="p-0 h-64 bg-black/40 rounded-xl flex items-center justify-center">
                    {(isLoadingSalesData) ? (
                        <div className="text-center">
                            <BarChart3 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-2" />
                            <p className="text-gray-400">Carregando dados do gráfico...</p>
                        </div>
                    ) : (salesData && salesData.length > 0) ? (
                        <div className="relative w-full h-full p-4">
                            <SalesLineChart data={salesData} />
                        </div>
                    ) : (
                        <div className="text-center">
                            <BarChart3 className="h-8 w-8 text-gray-500 mx-auto mb-2" />
                            <p className="text-gray-400">Nenhum dado de vendas encontrado para os últimos 30 dias.</p>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

export default ManagerReports;
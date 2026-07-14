import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowLeft, BarChart3, FileText, TrendingUp, Users, DollarSign, ClipboardList, Activity, Receipt, Wallet, Banknote, FileSpreadsheet, Ticket, Gift, ScrollText, AlertTriangle } from 'lucide-react';
import { useProfile } from '@/hooks/use-profile';
import { usePageAuth } from '@/hooks/use-page-auth';
import { useSalesChartData } from '@/hooks/use-sales-chart-data';
import SalesLineChart from '@/components/SalesLineChart';
import { useManagerCompany } from '@/hooks/use-manager-company';
import { useCompanyPlanFeatures } from '@/hooks/use-company-plan-features';
import { isCompanyBillingReady } from '@/constants/billing-plans';
import { isConsumptionOrLicensePlan, companyAllowsTicketSales } from '@/utils/company-billing-rules';
import { isPlanFeatureEnabled, type PlanFeatureKey } from '@/constants/plan-features';
import { useCompanyBilling } from '@/hooks/use-company-billing';
import { useCreditReportsAccess } from '@/hooks/use-credit-reports-access';

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

const REPORT_CARDS: Array<{
    featureKey: PlanFeatureKey;
    icon: React.ReactNode;
    title: string;
    description: string;
    path: string;
}> = [
    {
        featureKey: 'reports_financial',
        icon: <DollarSign className="h-6 w-6 text-yellow-500" />,
        title: 'Relatório Financeiro',
        description: 'Valores vendidos, comissões do sistema e valores líquidos dos organizadores por evento.',
        path: '/manager/reports/financial',
    },
    {
        featureKey: 'reports_sales',
        icon: <TrendingUp className="h-6 w-6 text-yellow-500" />,
        title: 'Relatório de Vendas',
        description: 'Análise detalhada de receita, ingressos vendidos e performance por evento.',
        path: '/manager/reports/sales',
    },
    {
        featureKey: 'reports_events',
        icon: <FileText className="h-6 w-6 text-yellow-500" />,
        title: 'Relatório de Eventos',
        description: 'Status, ocupação e dados cadastrais de todos os eventos ativos e passados.',
        path: '/manager/reports/events',
    },
    {
        featureKey: 'reports_audience',
        icon: <Users className="h-6 w-6 text-yellow-500" />,
        title: 'Relatório de Público',
        description: 'Dados demográficos e comportamento dos clientes que compraram ingressos.',
        path: '/manager/reports/audience',
    },
    {
        featureKey: 'reports_registrations',
        icon: <ClipboardList className="h-6 w-6 text-yellow-500" />,
        title: 'Relatório de Inscrições',
        description: 'Lista de inscritos por evento, com coluna de confirmação para impressão e controle de presença.',
        path: '/manager/reports/registrations',
    },
    {
        featureKey: 'reports_wristband_movements',
        icon: <Activity className="h-6 w-6 text-yellow-500" />,
        title: 'Movimentação de Ingressos',
        description: 'Entradas e saídas por ingresso em cada evento, com total de passagens na portaria.',
        path: '/manager/reports/wristband-movements',
    },
    {
        featureKey: 'reports_listing_monthly',
        icon: <Receipt className="h-6 w-6 text-yellow-500" />,
        title: 'Mensalidade de divulgação',
        description: 'Faturas mensais do plano vitrine (sem venda de ingressos pela plataforma).',
        path: '/manager/reports/listing-monthly',
    },
];

const ManagerReports: React.FC = () => {
    const navigate = useNavigate();
    const { userId } = usePageAuth();

    const { profile } = useProfile(userId);
    const isAdminMaster = profile?.tipo_usuario_id === 1;
    const isManagerPro = profile?.tipo_usuario_id === 2;
    const { company } = useManagerCompany(isManagerPro && !isAdminMaster ? userId : undefined);
    const { billing } = useCompanyBilling(company?.id);
    const billingReady = isCompanyBillingReady(billing);
    const { features } = useCompanyPlanFeatures(company?.id, {
        isAdminMaster,
        enabled: isManagerPro && !isAdminMaster && !!company?.id,
    });
    const { data: salesData, isLoading: isLoadingSalesData } = useSalesChartData(userId, isAdminMaster || false);
    const creditAccess = useCreditReportsAccess(userId);

    const visibleReports = REPORT_CARDS.filter((card) =>
        isPlanFeatureEnabled(features, card.featureKey, isAdminMaster) &&
            (isAdminMaster || billingReady),
    );

    const showCreditReport = creditAccess.showCreditReportCards;
    const showConsumptionLicenseReport =
        !isAdminMaster && isConsumptionOrLicensePlan(billing?.billing_plan);
    const showTicketChargebacks =
        isManagerPro &&
        !isAdminMaster &&
        billingReady &&
        companyAllowsTicketSales(billing?.billing_plan) &&
        isPlanFeatureEnabled(features, 'reports_financial', false);

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

            {visibleReports.length === 0 && !showCreditReport && !showConsumptionLicenseReport && !showTicketChargebacks ? (
                <p className="text-gray-400 text-sm mb-8">
                    Nenhum relatório disponível no plano comercial da sua empresa.
                </p>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
                    {visibleReports.map((card) => (
                        <ReportCard
                            key={card.path}
                            icon={card.icon}
                            title={card.title}
                            description={card.description}
                            onClick={() => navigate(card.path)}
                        />
                    ))}
                    {showCreditReport && creditAccess.isAdminMaster && (
                        <>
                            <ReportCard
                                icon={<TrendingUp className="h-6 w-6 text-yellow-500" />}
                                title="Receita da plataforma"
                                description="Mensalidade vitrine, licença consumo, taxa de inatividade e comissões (Admin Master)."
                                onClick={() =>
                                    navigate('/admin/settings/credit-reports', {
                                        state: { creditTab: 'revenue' },
                                    })
                                }
                            />
                            <ReportCard
                                icon={<Banknote className="h-6 w-6 text-yellow-500" />}
                                title="Repasses de crédito (rede)"
                                description="Liquidações e payouts de crédito de todas as empresas."
                                onClick={() =>
                                    navigate('/admin/settings/credit-reports', {
                                        state: { creditTab: 'settlements' },
                                    })
                                }
                            />
                            <ReportCard
                                icon={<FileSpreadsheet className="h-6 w-6 text-yellow-500" />}
                                title="Relatório contábil (créditos)"
                                description="Toda a rede EventFest — recargas, consumos e estornos (CSV para contador)."
                                onClick={() =>
                                    navigate('/admin/settings/credit-reports', {
                                        state: { creditTab: 'accounting' },
                                    })
                                }
                            />
                            <ReportCard
                                icon={<Wallet className="h-6 w-6 text-yellow-500" />}
                                title="Painel créditos Admin"
                                description="Passivo, auditoria, posição financeira e conciliação Mercado Pago."
                                onClick={() => navigate('/admin/settings/credit-reports')}
                            />
                            <ReportCard
                                icon={<ScrollText className="h-6 w-6 text-yellow-500" />}
                                title="Aceites de contrato"
                                description="Auditoria de aceites por empresa: versão, hash, snapshot, usuário e data/hora."
                                onClick={() => navigate('/manager/reports/admin-contract-acceptances')}
                            />
                        </>
                    )}
                    {showCreditReport && !creditAccess.isAdminMaster && (
                        <>
                            <ReportCard
                                icon={<Wallet className="h-6 w-6 text-yellow-500" />}
                                title="Consumos via crédito"
                                description="Recebimentos via carteira EventFest na sua empresa (ingressos e PDV)."
                                onClick={() => navigate('/manager/reports/credit-spends')}
                            />
                            <ReportCard
                                icon={<Banknote className="h-6 w-6 text-yellow-500" />}
                                title="Repasses de crédito"
                                description="Liquidações em retenção, liberadas e payouts registrados."
                                onClick={() => navigate('/manager/credit/settlements')}
                            />
                            <ReportCard
                                icon={<FileSpreadsheet className="h-6 w-6 text-yellow-500" />}
                                title="Relatório contábil (créditos)"
                                description="Recargas originadas na empresa, consumos recebidos e repasses — exportável CSV."
                                onClick={() => navigate('/manager/reports/credit-accounting')}
                            />
                        </>
                    )}
                    {showTicketChargebacks && (
                        <ReportCard
                            icon={<AlertTriangle className="h-6 w-6 text-amber-400" />}
                            title="Chargebacks de ingresso"
                            description="Dívidas por chargeback MP: devolução PIX/TED (plano só ingresso) ou desconto no repasse de crédito."
                            onClick={() => navigate('/manager/reports/ticket-chargebacks')}
                        />
                    )}
                    {showConsumptionLicenseReport && billingReady && (
                        <ReportCard
                            icon={<Receipt className="h-6 w-6 text-yellow-500" />}
                            title="Licença mensal de consumo"
                            description="Faturas da licença do plano consumo/licença — pagamento libera o módulo de créditos."
                            onClick={() => navigate('/manager/reports/consumption-license')}
                        />
                    )}
                    {isManagerPro && !isAdminMaster && isPlanFeatureEnabled(features, 'wristbands', false) && billingReady && (
                        <ReportCard
                            icon={<Gift className="h-6 w-6 text-cyan-400" />}
                            title="Pacotes cortesia"
                            description="Pacotes Staff enviados, resgates por ingresso e destinatários — exclusivo do gestor."
                            onClick={() => navigate('/manager/reports/complimentary-bundles')}
                        />
                    )}
                    {isAdminMaster && (
                        <ReportCard
                            icon={<Ticket className="h-6 w-6 text-cyan-400" />}
                            title="Estoque de ingressos (Admin)"
                            description="Por empresa e evento: total criado, vendido e ainda disponível para venda. Exclusivo Admin Master."
                            onClick={() => navigate('/manager/reports/admin-ticket-inventory')}
                        />
                    )}
                </div>
            )}
            
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
                            <SalesLineChart data={salesData} datasetLabel="Faturamento diário" />
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

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
    ArrowLeft,
    BarChart3,
    FileText,
    TrendingUp,
    Users,
    DollarSign,
    ClipboardList,
    Activity,
    Receipt,
    Wallet,
    Banknote,
    FileSpreadsheet,
    Ticket,
    Gift,
    ScrollText,
    AlertTriangle,
    MessageSquareHeart,
    CircleHelp,
} from 'lucide-react';
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
import AdminCommissionChartCard from '@/components/admin/AdminCommissionChartCard';
import ReportsGuideDialog from '@/components/ReportsGuideDialog';
import { getReportsGuideEntry } from '@/constants/reports-guide';

type ReportCardProps = {
    icon: React.ReactNode;
    title: string;
    description: string;
    guideId?: string;
    onClick: () => void;
    onHelp?: (guideId: string) => void;
};

const ReportCard: React.FC<ReportCardProps> = ({
    icon,
    title,
    description,
    guideId,
    onClick,
    onHelp,
}) => (
    <Card className="bg-black border border-yellow-500/30 rounded-2xl p-6 hover:border-yellow-500/60 hover:shadow-2xl hover:shadow-yellow-500/20 transition-all duration-300 relative">
        {guideId && onHelp && (
            <button
                type="button"
                title="Como funciona este relatório"
                aria-label={`Ajuda: ${title}`}
                className="absolute top-4 right-4 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border border-yellow-500/40 bg-black/80 text-yellow-500 hover:bg-yellow-500/15 hover:text-yellow-400"
                onClick={(e) => {
                    e.stopPropagation();
                    onHelp(guideId);
                }}
            >
                <CircleHelp className="h-4 w-4" />
            </button>
        )}
        <button type="button" className="w-full text-left cursor-pointer" onClick={onClick}>
            <CardHeader className="p-0 mb-4 pr-10">
                <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-yellow-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
                        {icon}
                    </div>
                    <CardTitle className="text-white text-xl">{title}</CardTitle>
                </div>
            </CardHeader>
            <CardContent className="p-0">
                <CardDescription className="text-gray-400 text-sm">{description}</CardDescription>
                {guideId && (
                    <span
                        role="link"
                        tabIndex={0}
                        className="mt-3 inline-flex items-center gap-1 text-xs text-yellow-500/90 hover:text-yellow-400 underline-offset-2 hover:underline"
                        onClick={(e) => {
                            e.stopPropagation();
                            onHelp?.(guideId);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                e.stopPropagation();
                                onHelp?.(guideId);
                            }
                        }}
                    >
                        <CircleHelp className="h-3.5 w-3.5" />
                        Para que serve este relatório?
                    </span>
                )}
            </CardContent>
        </button>
    </Card>
);

const REPORT_CARDS: Array<{
    featureKey: PlanFeatureKey;
    guideId: string;
    icon: React.ReactNode;
    title: string;
    description: string;
    path: string;
}> = [
    {
        featureKey: 'reports_financial',
        guideId: 'financial',
        icon: <DollarSign className="h-6 w-6 text-yellow-500" />,
        title: 'Relatório Financeiro',
        description:
            getReportsGuideEntry('financial')?.summary ??
            'Valores vendidos, comissões do sistema e valores líquidos dos organizadores por evento.',
        path: '/manager/reports/financial',
    },
    {
        featureKey: 'reports_sales',
        guideId: 'sales',
        icon: <TrendingUp className="h-6 w-6 text-yellow-500" />,
        title: 'Relatório de Vendas',
        description:
            getReportsGuideEntry('sales')?.summary ??
            'Análise detalhada de receita, ingressos vendidos e performance por evento.',
        path: '/manager/reports/sales',
    },
    {
        featureKey: 'reports_events',
        guideId: 'events',
        icon: <FileText className="h-6 w-6 text-yellow-500" />,
        title: 'Relatório de Eventos',
        description:
            getReportsGuideEntry('events')?.summary ??
            'Status, ocupação e dados cadastrais de todos os eventos ativos e passados.',
        path: '/manager/reports/events',
    },
    {
        featureKey: 'reports_audience',
        guideId: 'audience',
        icon: <Users className="h-6 w-6 text-yellow-500" />,
        title: 'Relatório de Público',
        description:
            getReportsGuideEntry('audience')?.summary ??
            'Dados demográficos e comportamento dos clientes que compraram ingressos.',
        path: '/manager/reports/audience',
    },
    {
        featureKey: 'reports_registrations',
        guideId: 'registrations',
        icon: <ClipboardList className="h-6 w-6 text-yellow-500" />,
        title: 'Relatório de Inscrições',
        description:
            getReportsGuideEntry('registrations')?.summary ??
            'Lista de inscritos por evento, com coluna de confirmação para impressão e controle de presença.',
        path: '/manager/reports/registrations',
    },
    {
        featureKey: 'reports_wristband_movements',
        guideId: 'wristband-movements',
        icon: <Activity className="h-6 w-6 text-yellow-500" />,
        title: 'Movimentação de Ingressos',
        description:
            getReportsGuideEntry('wristband-movements')?.summary ??
            'Entradas e saídas por ingresso em cada evento, com total de passagens na portaria.',
        path: '/manager/reports/wristband-movements',
    },
    {
        featureKey: 'reports_listing_monthly',
        guideId: 'listing-monthly',
        icon: <Receipt className="h-6 w-6 text-yellow-500" />,
        title: 'Mensalidade de divulgação',
        description:
            getReportsGuideEntry('listing-monthly')?.summary ??
            'Faturas mensais do plano vitrine (sem venda de ingressos pela plataforma).',
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
    const { data: salesData, isLoading: isLoadingSalesData } = useSalesChartData(
        isAdminMaster ? undefined : userId,
        false,
    );
    const creditAccess = useCreditReportsAccess(userId);

    const [guideOpen, setGuideOpen] = useState(false);
    const [guideFocusId, setGuideFocusId] = useState<string | null>(null);

    const openGuide = (entryId?: string) => {
        setGuideFocusId(entryId ?? null);
        setGuideOpen(true);
    };

    const visibleReports = REPORT_CARDS.filter(
        (card) =>
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
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center">
                    <BarChart3 className="h-7 w-7 mr-3" />
                    Central de Relatórios
                </h1>
                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => openGuide()}
                        className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400 text-sm"
                    >
                        <CircleHelp className="mr-2 h-4 w-4" />
                        Guia dos relatórios
                    </Button>
                    <Button
                        onClick={() => navigate('/manager/dashboard')}
                        variant="outline"
                        className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 text-sm"
                    >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Voltar ao Dashboard
                    </Button>
                </div>
            </div>

            <p className="text-gray-400 text-sm mb-8 max-w-3xl">
                Cada card abre o relatório. Use o{' '}
                <button
                    type="button"
                    className="text-yellow-500 hover:text-yellow-400 underline-offset-2 hover:underline"
                    onClick={() => openGuide()}
                >
                    Guia dos relatórios
                </button>{' '}
                ou o link “Para que serve” / ícone ? em cada card para ver finalidade, funcionamento e o que
                deve bater entre gestor e Admin Master.
            </p>

            {visibleReports.length === 0 &&
            !showCreditReport &&
            !showConsumptionLicenseReport &&
            !showTicketChargebacks ? (
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
                            guideId={card.guideId}
                            onHelp={openGuide}
                            onClick={() => navigate(card.path)}
                        />
                    ))}
                    {showCreditReport && creditAccess.isAdminMaster && (
                        <>
                            <ReportCard
                                icon={<TrendingUp className="h-6 w-6 text-yellow-500" />}
                                title="Receita da plataforma"
                                description={
                                    getReportsGuideEntry('admin-revenue')?.summary ??
                                    'Mensalidade vitrine, licença consumo, taxa de inatividade e comissões.'
                                }
                                guideId="admin-revenue"
                                onHelp={openGuide}
                                onClick={() =>
                                    navigate('/admin/settings/credit-reports', {
                                        state: { creditTab: 'revenue' },
                                    })
                                }
                            />
                            <ReportCard
                                icon={<Banknote className="h-6 w-6 text-yellow-500" />}
                                title="Repasses de crédito (rede)"
                                description={
                                    getReportsGuideEntry('admin-settlements')?.summary ??
                                    'Liquidações e payouts de crédito de todas as empresas.'
                                }
                                guideId="admin-settlements"
                                onHelp={openGuide}
                                onClick={() =>
                                    navigate('/admin/settings/credit-reports', {
                                        state: { creditTab: 'settlements' },
                                    })
                                }
                            />
                            <ReportCard
                                icon={<FileSpreadsheet className="h-6 w-6 text-yellow-500" />}
                                title="Relatório contábil (créditos)"
                                description={
                                    getReportsGuideEntry('admin-accounting')?.summary ??
                                    'Toda a rede EventFest — recargas, consumos e estornos (CSV).'
                                }
                                guideId="admin-accounting"
                                onHelp={openGuide}
                                onClick={() =>
                                    navigate('/admin/settings/credit-reports', {
                                        state: { creditTab: 'accounting' },
                                    })
                                }
                            />
                            <ReportCard
                                icon={<Wallet className="h-6 w-6 text-yellow-500" />}
                                title="Painel créditos Admin"
                                description={
                                    getReportsGuideEntry('admin-credit-panel')?.summary ??
                                    'Passivo, auditoria, posição financeira e conciliação Mercado Pago.'
                                }
                                guideId="admin-credit-panel"
                                onHelp={openGuide}
                                onClick={() => navigate('/admin/settings/credit-reports')}
                            />
                            <ReportCard
                                icon={<ScrollText className="h-6 w-6 text-yellow-500" />}
                                title="Aceites de contrato"
                                description={
                                    getReportsGuideEntry('admin-contract-acceptances')?.summary ??
                                    'Auditoria de aceites por empresa.'
                                }
                                guideId="admin-contract-acceptances"
                                onHelp={openGuide}
                                onClick={() => navigate('/manager/reports/admin-contract-acceptances')}
                            />
                        </>
                    )}
                    {showCreditReport && !creditAccess.isAdminMaster && (
                        <>
                            <ReportCard
                                icon={<Wallet className="h-6 w-6 text-yellow-500" />}
                                title="Consumos via crédito"
                                description={
                                    getReportsGuideEntry('credit-spends')?.summary ??
                                    'Recebimentos via carteira EventFest na sua empresa.'
                                }
                                guideId="credit-spends"
                                onHelp={openGuide}
                                onClick={() => navigate('/manager/reports/credit-spends')}
                            />
                            <ReportCard
                                icon={<Banknote className="h-6 w-6 text-yellow-500" />}
                                title="Repasses de crédito"
                                description={
                                    getReportsGuideEntry('credit-settlements')?.summary ??
                                    'Liquidações em retenção, liberadas e payouts registrados.'
                                }
                                guideId="credit-settlements"
                                onHelp={openGuide}
                                onClick={() => navigate('/manager/credit/settlements')}
                            />
                            <ReportCard
                                icon={<FileSpreadsheet className="h-6 w-6 text-yellow-500" />}
                                title="Relatório contábil (créditos)"
                                description={
                                    getReportsGuideEntry('credit-accounting')?.summary ??
                                    'Recargas, consumos e repasses — exportável CSV.'
                                }
                                guideId="credit-accounting"
                                onHelp={openGuide}
                                onClick={() => navigate('/manager/reports/credit-accounting')}
                            />
                        </>
                    )}
                    {showTicketChargebacks && (
                        <ReportCard
                            icon={<AlertTriangle className="h-6 w-6 text-amber-400" />}
                            title="Chargebacks de ingresso"
                            description={
                                getReportsGuideEntry('ticket-chargebacks')?.summary ??
                                'Dívidas por chargeback MP.'
                            }
                            guideId="ticket-chargebacks"
                            onHelp={openGuide}
                            onClick={() => navigate('/manager/reports/ticket-chargebacks')}
                        />
                    )}
                    {showConsumptionLicenseReport && billingReady && (
                        <ReportCard
                            icon={<Receipt className="h-6 w-6 text-yellow-500" />}
                            title="Licença mensal de consumo"
                            description={
                                getReportsGuideEntry('consumption-license')?.summary ??
                                'Faturas da licença do plano consumo/licença.'
                            }
                            guideId="consumption-license"
                            onHelp={openGuide}
                            onClick={() => navigate('/manager/reports/consumption-license')}
                        />
                    )}
                    {isManagerPro &&
                        !isAdminMaster &&
                        isPlanFeatureEnabled(features, 'wristbands', false) &&
                        billingReady && (
                            <ReportCard
                                icon={<Gift className="h-6 w-6 text-cyan-400" />}
                                title="Pacotes cortesia"
                                description={
                                    getReportsGuideEntry('complimentary-bundles')?.summary ??
                                    'Pacotes Staff enviados e resgates.'
                                }
                                guideId="complimentary-bundles"
                                onHelp={openGuide}
                                onClick={() => navigate('/manager/reports/complimentary-bundles')}
                            />
                        )}
                    {isManagerPro &&
                        !isAdminMaster &&
                        isPlanFeatureEnabled(features, 'reports', false) &&
                        billingReady && (
                            <ReportCard
                                icon={<MessageSquareHeart className="h-6 w-6 text-yellow-500" />}
                                title="Feedback dos clientes"
                                description={
                                    getReportsGuideEntry('feedback')?.summary ??
                                    'Notas e opiniões dos clientes.'
                                }
                                guideId="feedback"
                                onHelp={openGuide}
                                onClick={() => navigate('/manager/reports/feedback')}
                            />
                        )}
                    {isAdminMaster && (
                        <ReportCard
                            icon={<Ticket className="h-6 w-6 text-cyan-400" />}
                            title="Estoque de ingressos (Admin)"
                            description={
                                getReportsGuideEntry('admin-ticket-inventory')?.summary ??
                                'Por empresa e evento: criado, vendido e disponível.'
                            }
                            guideId="admin-ticket-inventory"
                            onHelp={openGuide}
                            onClick={() => navigate('/manager/reports/admin-ticket-inventory')}
                        />
                    )}
                </div>
            )}

            {isAdminMaster ? (
                <AdminCommissionChartCard enabled />
            ) : (
                <Card className="bg-black border border-yellow-500/30 rounded-2xl p-6">
                    <CardHeader className="p-0 mb-4">
                        <CardTitle className="text-white text-xl flex items-center">
                            <BarChart3 className="h-5 w-5 mr-2 text-yellow-500" />
                            Visualização Rápida
                        </CardTitle>
                        <CardDescription className="text-gray-400 text-sm">
                            Faturamento dos últimos 30 dias.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0 h-64 bg-black/40 rounded-xl flex items-center justify-center">
                        {isLoadingSalesData ? (
                            <div className="text-center">
                                <BarChart3 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-2" />
                                <p className="text-gray-400">Carregando dados do gráfico...</p>
                            </div>
                        ) : salesData && salesData.length > 0 ? (
                            <div className="relative w-full h-full p-4">
                                <SalesLineChart data={salesData} datasetLabel="Faturamento diário" />
                            </div>
                        ) : (
                            <div className="text-center">
                                <BarChart3 className="h-8 w-8 text-gray-500 mx-auto mb-2" />
                                <p className="text-gray-400">
                                    Nenhum dado de vendas encontrado para os últimos 30 dias.
                                </p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            <ReportsGuideDialog
                open={guideOpen}
                onOpenChange={setGuideOpen}
                isAdminMaster={isAdminMaster}
                focusEntryId={guideFocusId}
            />
        </div>
    );
};

export default ManagerReports;

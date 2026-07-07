import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Banknote, FileSpreadsheet, Loader2, Wallet, Scale, MapPin, Shield, Undo2, TrendingUp, AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { invokeEdgeFunctionRest } from '@/utils/edge-function-rest';
import CreditAccountingReportPanel from '@/components/CreditAccountingReportPanel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    useAdminCreditFinancialPosition,
    useAdminCreditMpReconciliationIssues,
    useAdminCreditAuditLog,
    useAdminCreditCommissionReport,
    useAdminCreditCrossCompanyFlows,
    useAdminCreditReconciliation,
    useAdminCreditRefundCases,
    useAdminCreditSettlements,
    useAdminCreditTopupChargebacks,
    useAdminCreditTopupChargebackSummary,
    fetchAdminCreditTopupChargebacksExport,
    useAdminPlatformBillingRevenue,
} from '@/hooks/use-credit-reports';
import { usePageAuth } from '@/hooks/use-page-auth';
import { adminCreditRefund } from '@/utils/credit-manager-payout';
import { exportCreditTopupChargebacksCsv } from '@/utils/export-credit-topup-chargebacks-csv';
import { showError, showSuccess } from '@/utils/toast';

function money(v: number | undefined | null): string {
    return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dt(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('pt-BR');
}

function settlementStatusLabel(s: string): string {
    const map: Record<string, string> = {
        pending: 'Retenção',
        pending_mp: 'Aguardando MP',
        released: 'Liberado',
        paid: 'Pago',
        disbursed: 'Transferido (MP)',
        disbursement_failed: 'Falha MP',
        clawback: 'Clawback',
        cancelled: 'Cancelado',
    };
    return map[s] ?? s;
}

const ADMIN_CREDIT_REPORT_TABS = new Set([
    'liability',
    'commission',
    'cross',
    'audit',
    'settlements',
    'refunds',
    'accounting',
    'position',
    'revenue',
    'mp-recon',
    'chargebacks',
]);

const AdminCreditReports: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const queryClient = useQueryClient();
    const { authPending } = usePageAuth();
    const requestedTab = (location.state as { creditTab?: string } | null)?.creditTab;
    const initialTab =
        requestedTab && ADMIN_CREDIT_REPORT_TABS.has(requestedTab) ? requestedTab : 'liability';
    const [tab, setTab] = useState(initialTab);
    const [refundUserId, setRefundUserId] = useState('');
    const [refundAmount, setRefundAmount] = useState('');
    const [refundReason, setRefundReason] = useState('');
    const [refunding, setRefunding] = useState(false);
    const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);
    const [positionStartDate, setPositionStartDate] = useState('');
    const [positionEndDate, setPositionEndDate] = useState('');
    const [revenueStartDate, setRevenueStartDate] = useState('');
    const [revenueEndDate, setRevenueEndDate] = useState('');
    const [mpIssuesStartDate, setMpIssuesStartDate] = useState('');
    const [mpIssuesEndDate, setMpIssuesEndDate] = useState('');
    const [chargebackStartDate, setChargebackStartDate] = useState('');
    const [chargebackEndDate, setChargebackEndDate] = useState('');
    const [chargebackAbsorbOnly, setChargebackAbsorbOnly] = useState(false);
    const [chargebackExporting, setChargebackExporting] = useState(false);
    const [chargebackNotifying, setChargebackNotifying] = useState(false);

    useEffect(() => {
        if (requestedTab && ADMIN_CREDIT_REPORT_TABS.has(requestedTab)) {
            setTab(requestedTab);
        }
    }, [requestedTab]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const { data } = await supabase
                .from('companies')
                .select('id, corporate_name')
                .order('corporate_name');
            if (!cancelled && data) {
                setCompanies(
                    data.map((c) => ({
                        id: c.id as string,
                        name: String(c.corporate_name ?? c.id),
                    })),
                );
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const recon = useAdminCreditReconciliation();
    const position = useAdminCreditFinancialPosition(positionStartDate || null, positionEndDate || null);
    const platformRevenue = useAdminPlatformBillingRevenue(revenueStartDate || null, revenueEndDate || null);
    const mpIssues = useAdminCreditMpReconciliationIssues(mpIssuesStartDate || null, mpIssuesEndDate || null);
    const commission = useAdminCreditCommissionReport();
    const cross = useAdminCreditCrossCompanyFlows();
    const audit = useAdminCreditAuditLog();
    const settlements = useAdminCreditSettlements();
    const refundCases = useAdminCreditRefundCases();
    const chargebackSummary = useAdminCreditTopupChargebackSummary(
        chargebackStartDate || null,
        chargebackEndDate || null,
    );
    const chargebacks = useAdminCreditTopupChargebacks(
        chargebackStartDate || null,
        chargebackEndDate || null,
        chargebackAbsorbOnly,
    );

    const handleRefund = async (e: React.FormEvent) => {
        e.preventDefault();
        const uid = refundUserId.trim();
        if (!uid) {
            showError('Informe o UUID do cliente.');
            return;
        }
        setRefunding(true);
        try {
            const amount = refundAmount.trim() ? Number(refundAmount.replace(',', '.')) : null;
            if (amount !== null && (Number.isNaN(amount) || amount <= 0)) {
                showError('Valor inválido.');
                return;
            }
            const result = await adminCreditRefund(uid, amount, refundReason.trim() || 'Estorno administrativo EventFest.');
            showSuccess(`Estorno registrado. Saldo restante: ${money(result.balance)}`);
            setRefundAmount('');
            setRefundReason('');
            queryClient.invalidateQueries({ queryKey: ['adminCreditRefunds'] });
            queryClient.invalidateQueries({ queryKey: ['adminCreditSettlements'] });
        } catch (err: unknown) {
            showError(err instanceof Error ? err.message : 'Erro ao estornar.');
        } finally {
            setRefunding(false);
        }
    };

    const handleChargebackExport = async () => {
        setChargebackExporting(true);
        try {
            const rows = await fetchAdminCreditTopupChargebacksExport(
                chargebackStartDate || null,
                chargebackEndDate || null,
                chargebackAbsorbOnly,
            );
            exportCreditTopupChargebacksCsv(rows);
            showSuccess(`CSV exportado (${rows.length} linhas).`);
        } catch (err: unknown) {
            showError(err instanceof Error ? err.message : 'Erro ao exportar CSV.');
        } finally {
            setChargebackExporting(false);
        }
    };

    const handleChargebackNotify = async (digestMode = false) => {
        setChargebackNotifying(true);
        try {
            const payload = await invokeEdgeFunctionRest<{
                success?: boolean;
                emailsSent?: number;
                emailsFailed?: number;
                casesProcessed?: number;
                error?: string;
            }>(
                'run-credit-chargeback-notify-job',
                { digestMode, limit: 50 },
                { timeoutMs: 30_000 },
            );
            if (payload?.error) throw new Error(payload.error);
            if ((payload?.casesProcessed ?? 0) === 0) {
                showSuccess('Nenhum alerta pendente para envio.');
            } else {
                showSuccess(
                    `Alertas enviados: ${payload.emailsSent ?? 0} e-mail(s), ${payload.casesProcessed ?? 0} caso(s).`,
                );
            }
            queryClient.invalidateQueries({ queryKey: ['adminCreditTopupChargebacks'] });
            queryClient.invalidateQueries({ queryKey: ['adminCreditTopupChargebackSummary'] });
        } catch (err: unknown) {
            showError(err instanceof Error ? err.message : 'Erro ao enviar alertas.');
        } finally {
            setChargebackNotifying(false);
        }
    };

    if (authPending) {
        return (
            <div className="max-w-6xl mx-auto text-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Verificando autenticação…</p>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto">
            <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-serif text-yellow-500 flex items-center gap-2">
                        <Wallet className="h-7 w-7" />
                        Créditos EventFest — Admin
                    </h1>
                    <p className="text-gray-400 text-sm mt-1">
                        Passivo, comissões de consumo, fluxos cross-empresa e auditoria.
                    </p>
                </div>
                <Button variant="ghost" className="text-gray-400" onClick={() => navigate('/admin/dashboard')}>
                    <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
                </Button>
            </div>

            <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="bg-black border border-yellow-500/30 mb-4 flex flex-wrap h-auto">
                    <TabsTrigger value="liability" className="data-[state=active]:bg-yellow-500 data-[state=active]:text-black">
                        <Scale className="h-4 w-4 mr-1" /> Passivo
                    </TabsTrigger>
                    <TabsTrigger value="commission" className="data-[state=active]:bg-yellow-500 data-[state=active]:text-black">
                        Comissões
                    </TabsTrigger>
                    <TabsTrigger value="cross" className="data-[state=active]:bg-yellow-500 data-[state=active]:text-black">
                        <MapPin className="h-4 w-4 mr-1" /> Cross-empresa
                    </TabsTrigger>
                    <TabsTrigger value="audit" className="data-[state=active]:bg-yellow-500 data-[state=active]:text-black">
                        <Shield className="h-4 w-4 mr-1" /> Auditoria
                    </TabsTrigger>
                    <TabsTrigger value="settlements" className="data-[state=active]:bg-yellow-500 data-[state=active]:text-black">
                        <Banknote className="h-4 w-4 mr-1" /> Repasses
                    </TabsTrigger>
                    <TabsTrigger value="refunds" className="data-[state=active]:bg-yellow-500 data-[state=active]:text-black">
                        <Undo2 className="h-4 w-4 mr-1" /> Estornos
                    </TabsTrigger>
                    <TabsTrigger value="accounting" className="data-[state=active]:bg-yellow-500 data-[state=active]:text-black">
                        <FileSpreadsheet className="h-4 w-4 mr-1" /> Contábil
                    </TabsTrigger>
                    <TabsTrigger value="position" className="data-[state=active]:bg-yellow-500 data-[state=active]:text-black">
                        Posição financeira
                    </TabsTrigger>
                    <TabsTrigger value="revenue" className="data-[state=active]:bg-yellow-500 data-[state=active]:text-black">
                        <TrendingUp className="h-4 w-4 mr-1" /> Receita plataforma
                    </TabsTrigger>
                    <TabsTrigger value="mp-recon" className="data-[state=active]:bg-yellow-500 data-[state=active]:text-black">
                        Conciliação MP
                    </TabsTrigger>
                    <TabsTrigger
                        value="chargebacks"
                        className="data-[state=active]:bg-yellow-500 data-[state=active]:text-black relative"
                    >
                        <AlertTriangle className="h-4 w-4 mr-1" /> Chargebacks
                        {(chargebackSummary.data?.cases_with_platform_absorb ?? 0) > 0 && (
                            <span className="ml-1 inline-flex h-2 w-2 rounded-full bg-red-500" title="Absorção EventFest pendente" />
                        )}
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="liability">
                    <Card className="bg-black border-yellow-500/30">
                        <CardHeader>
                            <CardTitle className="text-white">Conciliação de passivo</CardTitle>
                            <CardDescription className="text-gray-400">
                                `platform_credit_liability` vs ledger vs saldos em carteira vs recargas MP.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {recon.isLoading ? (
                                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto" />
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                                    <Metric label="Passivo (cache)" value={money(recon.data?.liability_cached)} />
                                    <Metric label="Passivo (Σ ledger)" value={money(recon.data?.liability_from_ledger)} ok={recon.data?.liability_matches_ledger} />
                                    <Metric label="Σ saldos carteiras" value={money(recon.data?.total_wallet_balances)} ok={recon.data?.liability_matches_wallets} />
                                    <Metric label="Crédito emitido (recargas)" value={money(recon.data?.topup_credit_granted)} />
                                    <Metric label="Taxas MP (recargas)" value={money(recon.data?.topup_mp_fees)} />
                                    <Metric label="Caixa líquido MP" value={money(recon.data?.topup_net_cash)} />
                                    <Metric label="Consumos (gross)" value={money(recon.data?.spend_gross_total)} />
                                    <Metric label="Comissão plataforma (consumo)" value={money(recon.data?.platform_commission_total)} />
                                    <Metric label="Passivo esperado (topup − spend)" value={money(recon.data?.expected_liability_from_topups)} />
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="commission">
                    <Card className="bg-black border-yellow-500/30">
                        <CardHeader>
                            <CardTitle className="text-white">Comissão consumo por empresa receptora</CardTitle>
                        </CardHeader>
                        <CardContent className="overflow-x-auto">
                            {commission.isLoading ? (
                                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto" />
                            ) : (
                                <>
                                    <p className="text-yellow-500 text-sm mb-4">
                                        Total comissão: {money(Number(commission.data?.summary?.platform_commission))}
                                    </p>
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="border-yellow-500/20">
                                                <TableHead className="text-yellow-500">Empresa</TableHead>
                                                <TableHead className="text-yellow-500 text-right">Spends</TableHead>
                                                <TableHead className="text-yellow-500 text-right">Gross</TableHead>
                                                <TableHead className="text-yellow-500 text-right">Comissão EF</TableHead>
                                                <TableHead className="text-yellow-500 text-right">Líq. gestor</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {(commission.data?.items ?? []).map((row) => (
                                                <TableRow key={row.company_id} className="border-yellow-500/10">
                                                    <TableCell className="text-gray-200">{row.company_name}</TableCell>
                                                    <TableCell className="text-right text-gray-300">{row.spend_count}</TableCell>
                                                    <TableCell className="text-right text-gray-300">{money(row.spend_gross)}</TableCell>
                                                    <TableCell className="text-right text-yellow-400">{money(row.platform_commission)}</TableCell>
                                                    <TableCell className="text-right text-gray-300">{money(row.manager_net)}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="cross">
                    <Card className="bg-black border-yellow-500/30">
                        <CardHeader>
                            <CardTitle className="text-white">Recarga origem × spend receptor</CardTitle>
                            <CardDescription className="text-gray-400">
                                Usos em empresa diferente da origem da recarga (rede universal).
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="overflow-x-auto">
                            {cross.isLoading ? (
                                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto" />
                            ) : cross.data?.length === 0 ? (
                                <p className="text-gray-500 text-sm text-center py-8">Nenhum fluxo cross-empresa registrado.</p>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow className="border-yellow-500/20">
                                            <TableHead className="text-yellow-500">Data spend</TableHead>
                                            <TableHead className="text-yellow-500">Origem recarga</TableHead>
                                            <TableHead className="text-yellow-500">Receptor</TableHead>
                                            <TableHead className="text-yellow-500 text-right">Valor</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {cross.data?.map((row) => (
                                            <TableRow key={row.spend_order_id} className="border-yellow-500/10">
                                                <TableCell className="text-gray-300 text-xs">{dt(row.spend_at)}</TableCell>
                                                <TableCell className="text-gray-200">{row.origin_company_name ?? '—'}</TableCell>
                                                <TableCell className="text-gray-200">{row.receiver_company_name}</TableCell>
                                                <TableCell className="text-right text-yellow-400">{money(row.spend_amount)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="audit">
                    <Card className="bg-black border-yellow-500/30">
                        <CardHeader>
                            <CardTitle className="text-white">Auditoria forense</CardTitle>
                            <CardDescription className="text-gray-400">
                                Espelho imutável dos lançamentos de ledger (admin master).
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="overflow-x-auto max-h-[32rem]">
                            {audit.isLoading ? (
                                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto" />
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow className="border-yellow-500/20">
                                            <TableHead className="text-yellow-500">Data</TableHead>
                                            <TableHead className="text-yellow-500">Tipo</TableHead>
                                            <TableHead className="text-yellow-500">Empresa</TableHead>
                                            <TableHead className="text-yellow-500">Resumo</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {audit.data?.map((row) => (
                                            <TableRow key={row.id} className="border-yellow-500/10">
                                                <TableCell className="text-gray-400 text-xs whitespace-nowrap">{dt(row.created_at)}</TableCell>
                                                <TableCell className="text-gray-300 text-xs">{row.event_type}</TableCell>
                                                <TableCell className="text-gray-300 text-xs">{row.company_name ?? '—'}</TableCell>
                                                <TableCell className="text-gray-200 text-xs max-w-md truncate" title={row.summary}>{row.summary}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="settlements">
                    <Card className="bg-black border-yellow-500/30">
                        <CardHeader>
                            <CardTitle className="text-white">Transferências MP automáticas (rede)</CardTitle>
                            <CardDescription className="text-gray-400">
                                Repasse imediato ao gestor/parceiro receptor a cada consumo via crédito (pool EventFest → MP OAuth).
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="overflow-x-auto max-h-[32rem]">
                            {settlements.isLoading ? (
                                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto" />
                            ) : settlements.data?.length === 0 ? (
                                <p className="text-gray-500 text-sm text-center py-8">Nenhuma liquidação.</p>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow className="border-yellow-500/20">
                                            <TableHead className="text-yellow-500">Empresa</TableHead>
                                            <TableHead className="text-yellow-500">Status</TableHead>
                                            <TableHead className="text-yellow-500 text-right">Valor</TableHead>
                                            <TableHead className="text-yellow-500">Liberação</TableHead>
                                            <TableHead className="text-yellow-500">Ref. payout</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {settlements.data?.map((row) => (
                                            <TableRow key={String(row.id)} className="border-yellow-500/10">
                                                <TableCell className="text-gray-200 text-sm">{String(row.company_name ?? '—')}</TableCell>
                                                <TableCell className="text-gray-300 text-xs">{settlementStatusLabel(String(row.status ?? ''))}</TableCell>
                                                <TableCell className="text-right text-yellow-400">{money(Number(row.manager_amount))}</TableCell>
                                                <TableCell className="text-gray-400 text-xs">{dt(String(row.release_at ?? ''))}</TableCell>
                                                <TableCell className="text-gray-500 text-xs font-mono truncate max-w-[8rem]">
                                                    {String(row.mp_payout_reference ?? '—')}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="refunds">
                    <Card className="bg-black border-yellow-500/30 mb-6">
                        <CardHeader>
                            <CardTitle className="text-white">Novo estorno (débito na carteira)</CardTitle>
                            <CardDescription className="text-gray-400">
                                Debita crédito do cliente e aplica clawback em liquidações pendentes/liberadas. Valor vazio = saldo integral.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={handleRefund} className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
                                <div className="sm:col-span-2">
                                    <Label htmlFor="refund-user" className="text-gray-300">UUID do cliente</Label>
                                    <Input
                                        id="refund-user"
                                        value={refundUserId}
                                        onChange={(e) => setRefundUserId(e.target.value)}
                                        placeholder="00000000-0000-0000-0000-000000000000"
                                        className="bg-black border-yellow-500/30 text-white mt-1 font-mono text-sm"
                                    />
                                </div>
                                <div>
                                    <Label htmlFor="refund-amount" className="text-gray-300">Valor (R$) — opcional</Label>
                                    <Input
                                        id="refund-amount"
                                        value={refundAmount}
                                        onChange={(e) => setRefundAmount(e.target.value)}
                                        placeholder="Saldo total se vazio"
                                        className="bg-black border-yellow-500/30 text-white mt-1"
                                    />
                                </div>
                                <div>
                                    <Label htmlFor="refund-reason" className="text-gray-300">Motivo</Label>
                                    <Input
                                        id="refund-reason"
                                        value={refundReason}
                                        onChange={(e) => setRefundReason(e.target.value)}
                                        placeholder="Estorno administrativo EventFest."
                                        className="bg-black border-yellow-500/30 text-white mt-1"
                                    />
                                </div>
                                <div className="sm:col-span-2">
                                    <Button type="submit" disabled={refunding} className="bg-yellow-500 text-black hover:bg-yellow-600">
                                        {refunding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Undo2 className="h-4 w-4 mr-2" />}
                                        Registrar estorno
                                    </Button>
                                </div>
                            </form>
                        </CardContent>
                    </Card>

                    <Card className="bg-black border-yellow-500/30">
                        <CardHeader>
                            <CardTitle className="text-white">Casos de estorno</CardTitle>
                        </CardHeader>
                        <CardContent className="overflow-x-auto max-h-[24rem]">
                            {refundCases.isLoading ? (
                                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto" />
                            ) : refundCases.data?.length === 0 ? (
                                <p className="text-gray-500 text-sm text-center py-8">Nenhum estorno registrado.</p>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow className="border-yellow-500/20">
                                            <TableHead className="text-yellow-500">Data</TableHead>
                                            <TableHead className="text-yellow-500">Cliente</TableHead>
                                            <TableHead className="text-yellow-500 text-right">Valor</TableHead>
                                            <TableHead className="text-yellow-500">Status</TableHead>
                                            <TableHead className="text-yellow-500">Clawbacks</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {refundCases.data?.map((row) => (
                                            <TableRow key={row.id} className="border-yellow-500/10">
                                                <TableCell className="text-gray-400 text-xs">{dt(row.created_at)}</TableCell>
                                                <TableCell className="text-gray-300 text-xs font-mono truncate max-w-[10rem]" title={row.client_user_id}>
                                                    {row.client_user_id}
                                                </TableCell>
                                                <TableCell className="text-right text-yellow-400">{money(row.refund_amount)}</TableCell>
                                                <TableCell className="text-gray-300 text-xs">{row.status}</TableCell>
                                                <TableCell className="text-gray-300 text-xs">{row.clawback_count}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="accounting">
                    <CreditAccountingReportPanel mode="admin" companies={companies} />
                </TabsContent>

                <TabsContent value="position">
                    <Card className="bg-black border-yellow-500/30 mb-4">
                        <CardHeader>
                            <CardTitle className="text-white">Posição Financeira Consolidada</CardTitle>
                            <CardDescription className="text-gray-400">
                                Visão gerencial separando crédito de cliente, receita de comissão e custos MP.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            <div>
                                <Label className="text-gray-300">Início</Label>
                                <Input
                                    type="date"
                                    value={positionStartDate}
                                    onChange={(e) => setPositionStartDate(e.target.value)}
                                    className="bg-black border-yellow-500/30 text-white mt-1"
                                />
                            </div>
                            <div>
                                <Label className="text-gray-300">Fim</Label>
                                <Input
                                    type="date"
                                    value={positionEndDate}
                                    onChange={(e) => setPositionEndDate(e.target.value)}
                                    className="bg-black border-yellow-500/30 text-white mt-1"
                                />
                            </div>
                            <div className="text-xs text-gray-500 flex items-end pb-2">
                                Deixe em branco para visão acumulada.
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-black border-yellow-500/30">
                        <CardHeader>
                            <CardTitle className="text-white">Resumo gerencial</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {position.isLoading ? (
                                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto" />
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                                    <Metric
                                        label="Passivo atual (crédito cliente)"
                                        value={money(position.data?.client_credit?.liability_now)}
                                    />
                                    <Metric
                                        label="Σ saldos carteiras (clientes)"
                                        value={money(position.data?.client_credit?.wallet_balances)}
                                    />
                                    <Metric
                                        label="Passivo esperado (período)"
                                        value={money(position.data?.client_credit?.expected_liability_from_period)}
                                    />

                                    <Metric
                                        label="Receita comissão EventFest"
                                        value={money(position.data?.platform_revenue?.platform_commission)}
                                    />
                                    <Metric
                                        label="Consumo bruto (gross)"
                                        value={money(position.data?.platform_revenue?.spend_gross)}
                                    />
                                    <Metric
                                        label="Repasse líquido gestores"
                                        value={money(position.data?.platform_revenue?.manager_net)}
                                    />

                                    <Metric
                                        label="Mensalidade vitrine (bruto recebido)"
                                        value={money(position.data?.platform_billing?.listing_monthly?.paid_revenue)}
                                    />
                                    <Metric
                                        label="Mensalidade vitrine (líquida após MP)"
                                        value={money(
                                            position.data?.platform_billing?.listing_monthly?.paid_revenue_net ??
                                                position.data?.platform_billing?.listing_monthly?.paid_revenue,
                                        )}
                                    />
                                    <Metric
                                        label="Licença consumo (bruto recebido)"
                                        value={money(position.data?.platform_billing?.consumption_license?.paid_revenue)}
                                    />
                                    <Metric
                                        label="Licença consumo (líquida após MP)"
                                        value={money(
                                            position.data?.platform_billing?.consumption_license?.paid_revenue_net ??
                                                position.data?.platform_billing?.consumption_license?.paid_revenue,
                                        )}
                                    />
                                    <Metric
                                        label="Taxa inatividade ingressos"
                                        value={money(position.data?.platform_billing?.ticket_inactivity?.paid_revenue)}
                                    />
                                    <Metric
                                        label="Comissão ingressos"
                                        value={money(position.data?.platform_billing?.ticket_commission?.revenue)}
                                    />
                                    <Metric
                                        label="Comissão consumo créditos"
                                        value={money(position.data?.platform_billing?.consumption_commission?.revenue)}
                                    />
                                    <Metric
                                        label="Taxas MP (mensalidade/licença)"
                                        value={money(position.data?.platform_billing?.totals?.billing_mp_fees)}
                                    />
                                    <Metric
                                        label="Receita líquida recorrente (período)"
                                        value={money(
                                            position.data?.platform_billing?.totals?.platform_revenue_net ??
                                                position.data?.platform_billing?.totals?.recurring_revenue_net,
                                        )}
                                    />
                                    <Metric
                                        label="Receita consolidada (recorrente + comissões)"
                                        value={money(
                                            position.data?.platform_billing?.totals?.consolidated_revenue_net,
                                        )}
                                    />

                                    <Metric
                                        label="Taxas MP (recarga)"
                                        value={money(position.data?.mp_costs?.topup_mp_fees)}
                                    />
                                    <Metric
                                        label="Caixa líquido MP (recarga)"
                                        value={money(position.data?.mp_costs?.topup_net_cash)}
                                    />
                                    <Metric
                                        label="Transferido MP para gestores"
                                        value={money(position.data?.mp_costs?.mp_disbursed_total)}
                                    />

                                    <Metric
                                        label="Falha de disbursement MP"
                                        value={money(position.data?.mp_costs?.mp_disbursed_failed)}
                                        ok={Number(position.data?.mp_costs?.mp_disbursed_failed ?? 0) === 0}
                                    />
                                    <Metric
                                        label="Caixa operacional disponível"
                                        value={money(position.data?.managerial_position?.available_operational_cash)}
                                    />
                                    <Metric
                                        label="Posição estimada carteira MP"
                                        value={money(position.data?.managerial_position?.estimated_mp_wallet_position)}
                                    />
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="revenue">
                    <Card className="bg-black border-yellow-500/30 mb-4">
                        <CardHeader>
                            <CardTitle className="text-white">Receita da plataforma EventFest</CardTitle>
                            <CardDescription className="text-gray-400">
                                Mensalidade e licença: bruto recebido, taxa MP e líquido. Comissões de ingresso/consumo
                                aparecem separadas; o total líquido principal não inclui comissões.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            <div>
                                <Label className="text-gray-300">Início</Label>
                                <Input
                                    type="date"
                                    value={revenueStartDate}
                                    onChange={(e) => setRevenueStartDate(e.target.value)}
                                    className="bg-black border-yellow-500/30 text-white mt-1"
                                />
                            </div>
                            <div>
                                <Label className="text-gray-300">Fim</Label>
                                <Input
                                    type="date"
                                    value={revenueEndDate}
                                    onChange={(e) => setRevenueEndDate(e.target.value)}
                                    className="bg-black border-yellow-500/30 text-white mt-1"
                                />
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-black border-yellow-500/30">
                        <CardHeader>
                            <CardTitle className="text-white">Breakdown de receita</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {platformRevenue.isLoading ? (
                                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto" />
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                                    <Metric
                                        label="Mensalidade vitrine (bruto recebido)"
                                        value={money(platformRevenue.data?.listing_monthly?.paid_revenue)}
                                    />
                                    <Metric
                                        label="Mensalidade vitrine (líquida após MP)"
                                        value={money(
                                            platformRevenue.data?.listing_monthly?.paid_revenue_net ??
                                                platformRevenue.data?.listing_monthly?.paid_revenue,
                                        )}
                                    />
                                    <Metric
                                        label="Mensalidade vitrine (pendente)"
                                        value={money(platformRevenue.data?.listing_monthly?.pending_amount)}
                                    />
                                    <Metric
                                        label="Licença consumo (bruto recebido)"
                                        value={money(platformRevenue.data?.consumption_license?.paid_revenue)}
                                    />
                                    <Metric
                                        label="Licença consumo (líquida após MP)"
                                        value={money(
                                            platformRevenue.data?.consumption_license?.paid_revenue_net ??
                                                platformRevenue.data?.consumption_license?.paid_revenue,
                                        )}
                                    />
                                    <Metric
                                        label="Licença consumo (pendente)"
                                        value={money(platformRevenue.data?.consumption_license?.pending_amount)}
                                    />
                                    <Metric
                                        label="Taxa inatividade ingressos (recebido)"
                                        value={money(platformRevenue.data?.ticket_inactivity?.paid_revenue)}
                                    />
                                    <Metric
                                        label="Taxa inatividade (pendente)"
                                        value={money(platformRevenue.data?.ticket_inactivity?.pending_amount)}
                                    />
                                    <Metric
                                        label="Comissão ingressos"
                                        value={money(platformRevenue.data?.ticket_commission?.revenue)}
                                    />
                                    <Metric
                                        label="Comissão consumo créditos"
                                        value={money(platformRevenue.data?.consumption_commission?.revenue)}
                                    />
                                    <Metric
                                        label="Taxas MP (mensalidade/licença)"
                                        value={money(platformRevenue.data?.totals?.billing_mp_fees)}
                                    />
                                    <Metric
                                        label="Recorrente líquido (vitrine + licença + inatividade)"
                                        value={money(
                                            platformRevenue.data?.totals?.recurring_revenue_net ??
                                                platformRevenue.data?.totals?.recurring_revenue,
                                        )}
                                    />
                                    <Metric
                                        label="Comissões (ingresso + consumo)"
                                        value={money(platformRevenue.data?.totals?.commission_revenue)}
                                    />
                                    <Metric
                                        label="Total receita líquida (mensalidade + licença)"
                                        value={money(
                                            platformRevenue.data?.totals?.platform_revenue_net ??
                                                platformRevenue.data?.totals?.recurring_revenue_net,
                                        )}
                                    />
                                    <Metric
                                        label="Receita consolidada (recorrente + comissões)"
                                        value={money(platformRevenue.data?.totals?.consolidated_revenue_net)}
                                    />
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="chargebacks">
                    {(chargebackSummary.data?.has_platform_loss_alert ?? false) && (
                        <Alert className="mb-4 border-red-500/50 bg-red-500/10 text-red-200">
                            <AlertTriangle className="h-4 w-4 text-red-400" />
                            <AlertTitle className="text-red-300">Absorção EventFest em chargebacks</AlertTitle>
                            <AlertDescription className="text-red-200/90">
                                {chargebackSummary.data?.cases_with_platform_absorb ?? 0} caso(s) com perda não recuperada
                                do cliente nem dos gestores — total{' '}
                                <strong>{money(chargebackSummary.data?.total_platform_absorb)}</strong>.
                                Revise os casos abaixo e a conciliação com o Mercado Pago.
                            </AlertDescription>
                        </Alert>
                    )}

                    <Card className="bg-black border-yellow-500/30 mb-4">
                        <CardHeader>
                            <CardTitle className="text-white">Chargebacks de recarga</CardTitle>
                            <CardDescription className="text-gray-400">
                                Estornos MP em recargas de crédito: débito na carteira, clawback proporcional ao gestor e absorção EventFest.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            <div>
                                <Label className="text-gray-300">Início</Label>
                                <Input
                                    type="date"
                                    value={chargebackStartDate}
                                    onChange={(e) => setChargebackStartDate(e.target.value)}
                                    className="bg-black border-yellow-500/30 text-white mt-1"
                                />
                            </div>
                            <div>
                                <Label className="text-gray-300">Fim</Label>
                                <Input
                                    type="date"
                                    value={chargebackEndDate}
                                    onChange={(e) => setChargebackEndDate(e.target.value)}
                                    className="bg-black border-yellow-500/30 text-white mt-1"
                                />
                            </div>
                            <div className="flex items-end">
                                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={chargebackAbsorbOnly}
                                        onChange={(e) => setChargebackAbsorbOnly(e.target.checked)}
                                        className="rounded border-yellow-500/50"
                                    />
                                    Somente com absorção EventFest
                                </label>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-black border-yellow-500/30 mb-4">
                        <CardHeader>
                            <CardTitle className="text-white">Resumo do período</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {chargebackSummary.isLoading ? (
                                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto" />
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                                    <Metric label="Total chargebacks" value={String(chargebackSummary.data?.total_cases ?? 0)} />
                                    <Metric
                                        label="Crédito concedido (estornado)"
                                        value={money(chargebackSummary.data?.total_credit_granted)}
                                    />
                                    <Metric
                                        label="Recuperado da carteira"
                                        value={money(chargebackSummary.data?.total_wallet_debit)}
                                    />
                                    <Metric
                                        label="Clawback gestores"
                                        value={money(chargebackSummary.data?.total_clawback_manager)}
                                    />
                                    <Metric
                                        label="Absorção EventFest"
                                        value={money(chargebackSummary.data?.total_platform_absorb)}
                                        ok={(chargebackSummary.data?.total_platform_absorb ?? 0) === 0 ? true : false}
                                    />
                                    <Metric
                                        label="Casos com absorção"
                                        value={String(chargebackSummary.data?.cases_with_platform_absorb ?? 0)}
                                        ok={(chargebackSummary.data?.cases_with_platform_absorb ?? 0) === 0 ? true : false}
                                    />
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="bg-black border-yellow-500/30">
                        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div>
                                <CardTitle className="text-white">Casos ({chargebacks.data?.total ?? 0})</CardTitle>
                                <CardDescription className="text-gray-400 text-sm mt-1">
                                    Exporte para contabilidade ou dispare alertas por e-mail pendentes.
                                </CardDescription>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={chargebackExporting}
                                    className="border-yellow-500/40 text-yellow-500 hover:bg-yellow-500/10"
                                    onClick={handleChargebackExport}
                                >
                                    {chargebackExporting ? (
                                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                                    ) : (
                                        <FileSpreadsheet className="h-4 w-4 mr-1" />
                                    )}
                                    Exportar CSV
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={chargebackNotifying}
                                    className="border-red-500/40 text-red-300 hover:bg-red-500/10"
                                    onClick={() => handleChargebackNotify(true)}
                                >
                                    {chargebackNotifying ? (
                                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                                    ) : (
                                        <AlertTriangle className="h-4 w-4 mr-1" />
                                    )}
                                    Enviar alertas pendentes
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="overflow-x-auto max-h-[32rem]">
                            {chargebacks.isLoading ? (
                                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto" />
                            ) : (chargebacks.data?.items ?? []).length === 0 ? (
                                <p className="text-gray-500 text-sm text-center py-8">Nenhum chargeback no período.</p>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow className="border-yellow-500/20">
                                            <TableHead className="text-yellow-500">Data</TableHead>
                                            <TableHead className="text-yellow-500">MP status</TableHead>
                                            <TableHead className="text-yellow-500">Cliente</TableHead>
                                            <TableHead className="text-yellow-500 text-right">Crédito</TableHead>
                                            <TableHead className="text-yellow-500 text-right">Carteira</TableHead>
                                            <TableHead className="text-yellow-500 text-right">Clawback</TableHead>
                                            <TableHead className="text-yellow-500 text-right">Absorção</TableHead>
                                            <TableHead className="text-yellow-500">Alerta</TableHead>
                                            <TableHead className="text-yellow-500">MP ID</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {chargebacks.data?.items.map((row) => (
                                            <TableRow
                                                key={row.id}
                                                className={`border-yellow-500/10 ${row.platform_absorb > 0 ? 'bg-red-500/5' : ''}`}
                                            >
                                                <TableCell className="text-gray-400 text-xs whitespace-nowrap">
                                                    {dt(row.created_at)}
                                                </TableCell>
                                                <TableCell className="text-gray-300 text-xs">{row.mp_status}</TableCell>
                                                <TableCell
                                                    className="text-gray-300 text-xs font-mono truncate max-w-[8rem]"
                                                    title={row.client_user_id}
                                                >
                                                    {row.client_user_id}
                                                </TableCell>
                                                <TableCell className="text-right text-yellow-400 text-xs">
                                                    {money(row.credit_granted_amount)}
                                                </TableCell>
                                                <TableCell className="text-right text-gray-300 text-xs">
                                                    {money(row.wallet_debit)}
                                                </TableCell>
                                                <TableCell className="text-right text-gray-300 text-xs">
                                                    {money(row.clawback_manager_total)}
                                                    <span className="text-gray-500 ml-1">({row.clawback_settlement_count})</span>
                                                </TableCell>
                                                <TableCell
                                                    className={`text-right text-xs font-medium ${
                                                        row.platform_absorb > 0 ? 'text-red-400' : 'text-green-400'
                                                    }`}
                                                >
                                                    {money(row.platform_absorb)}
                                                </TableCell>
                                                <TableCell className="text-gray-400 text-xs whitespace-nowrap">
                                                    {row.platform_absorb > 0
                                                        ? row.admin_notified_at
                                                            ? dt(row.admin_notified_at)
                                                            : 'Pendente'
                                                        : '—'}
                                                </TableCell>
                                                <TableCell
                                                    className="text-gray-500 text-xs font-mono truncate max-w-[8rem]"
                                                    title={row.mp_payment_id}
                                                >
                                                    {row.mp_payment_id}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="mp-recon">
                    <Card className="bg-black border-yellow-500/30 mb-4">
                        <CardHeader>
                            <CardTitle className="text-white">Conciliação MP — Divergências</CardTitle>
                            <CardDescription className="text-gray-400">
                                Itens com potencial risco financeiro/fiscal: faltantes, pendências e falhas.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            <div>
                                <Label className="text-gray-300">Início</Label>
                                <Input
                                    type="date"
                                    value={mpIssuesStartDate}
                                    onChange={(e) => setMpIssuesStartDate(e.target.value)}
                                    className="bg-black border-yellow-500/30 text-white mt-1"
                                />
                            </div>
                            <div>
                                <Label className="text-gray-300">Fim</Label>
                                <Input
                                    type="date"
                                    value={mpIssuesEndDate}
                                    onChange={(e) => setMpIssuesEndDate(e.target.value)}
                                    className="bg-black border-yellow-500/30 text-white mt-1"
                                />
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-black border-yellow-500/30">
                        <CardHeader>
                            <CardTitle className="text-white">Resumo de risco</CardTitle>
                            <CardDescription className="text-gray-400">
                                Priorize correção dos itens de severidade alta.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {mpIssues.isLoading ? (
                                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto" />
                            ) : (
                                <>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 text-sm">
                                        <Metric label="Total divergências" value={String(mpIssues.data?.summary?.total_issues ?? 0)} />
                                        <Metric label="Severidade alta" value={String(mpIssues.data?.summary?.high_severity ?? 0)} />
                                        <Metric label="Severidade média" value={String(mpIssues.data?.summary?.medium_severity ?? 0)} />
                                        <Metric label="Divergências de recarga" value={String(mpIssues.data?.summary?.topup_issues ?? 0)} />
                                        <Metric label="Divergências de spend/repasse" value={String(mpIssues.data?.summary?.spend_issues ?? 0)} />
                                    </div>

                                    <div className="overflow-x-auto max-h-[32rem]">
                                        <Table>
                                            <TableHeader>
                                                <TableRow className="border-yellow-500/20">
                                                    <TableHead className="text-yellow-500">Data</TableHead>
                                                    <TableHead className="text-yellow-500">Severidade</TableHead>
                                                    <TableHead className="text-yellow-500">Tipo</TableHead>
                                                    <TableHead className="text-yellow-500">Empresa</TableHead>
                                                    <TableHead className="text-yellow-500 text-right">Valor</TableHead>
                                                    <TableHead className="text-yellow-500">Referência</TableHead>
                                                    <TableHead className="text-yellow-500">Detalhes</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {(mpIssues.data?.items ?? []).map((row) => (
                                                    <TableRow key={`${row.reference_type}-${row.reference_id}-${row.issue_type}`} className="border-yellow-500/10">
                                                        <TableCell className="text-gray-400 text-xs whitespace-nowrap">
                                                            {dt(row.created_at)}
                                                        </TableCell>
                                                        <TableCell className={`text-xs ${row.severity === 'high' ? 'text-red-400' : 'text-amber-400'}`}>
                                                            {row.severity === 'high' ? 'Alta' : row.severity}
                                                        </TableCell>
                                                        <TableCell className="text-gray-300 text-xs">{row.issue_type}</TableCell>
                                                        <TableCell className="text-gray-300 text-xs">{row.company_name ?? '—'}</TableCell>
                                                        <TableCell className="text-right text-yellow-400 text-xs">
                                                            {row.amount != null ? money(Number(row.amount)) : '—'}
                                                        </TableCell>
                                                        <TableCell className="text-gray-500 text-xs font-mono truncate max-w-[12rem]">
                                                            {row.reference_type}:{row.reference_id}
                                                        </TableCell>
                                                        <TableCell className="text-gray-300 text-xs max-w-sm">
                                                            {row.details}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
};

function Metric({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
    return (
        <div className="rounded-lg border border-yellow-500/20 p-3 bg-black/40">
            <p className="text-gray-500 text-xs mb-1">{label}</p>
            <p className={`text-lg font-semibold ${ok === false ? 'text-red-400' : ok === true ? 'text-green-400' : 'text-white'}`}>
                {value}
            </p>
        </div>
    );
}

export default AdminCreditReports;

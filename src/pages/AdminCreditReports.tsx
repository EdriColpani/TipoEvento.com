import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Banknote, FileSpreadsheet, Loader2, Wallet, Scale, MapPin, Shield, Undo2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
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
    useAdminCreditAuditLog,
    useAdminCreditCommissionReport,
    useAdminCreditCrossCompanyFlows,
    useAdminCreditReconciliation,
    useAdminCreditRefundCases,
    useAdminCreditSettlements,
} from '@/hooks/use-credit-reports';
import { adminCreditRefund } from '@/utils/credit-manager-payout';
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

const AdminCreditReports: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const queryClient = useQueryClient();
    const initialTab =
        (location.state as { creditTab?: string } | null)?.creditTab === 'accounting'
            ? 'accounting'
            : 'liability';
    const [tab, setTab] = useState(initialTab);
    const [refundUserId, setRefundUserId] = useState('');
    const [refundAmount, setRefundAmount] = useState('');
    const [refundReason, setRefundReason] = useState('');
    const [refunding, setRefunding] = useState(false);
    const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);

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
    const commission = useAdminCreditCommissionReport();
    const cross = useAdminCreditCrossCompanyFlows();
    const audit = useAdminCreditAuditLog();
    const settlements = useAdminCreditSettlements();
    const refundCases = useAdminCreditRefundCases();

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

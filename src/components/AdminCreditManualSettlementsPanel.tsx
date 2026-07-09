import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, Loader2, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    fetchAdminCreditSettlementsExport,
    useAdminCreditSettlementsGrouped,
    type AdminSettlementGroupedCompany,
    type ManagerSettlementRow,
} from '@/hooks/use-credit-reports';
import { registerAdminCreditSettlementPayment } from '@/utils/credit-manager-payout';
import { exportCreditSettlementsCsv } from '@/utils/export-credit-settlements-csv';
import { showError, showSuccess } from '@/utils/toast';

function money(v: number): string {
    return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dt(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('pt-BR');
}

function groupTypeLabel(t: string): string {
    if (t === 'event') return 'Evento';
    if (t === 'establishment') return 'Estabelecimento parceiro';
    return 'Empresa';
}

type SettlementViewFilter = 'released' | 'pending';

const AdminCreditManualSettlementsPanel: React.FC = () => {
    const queryClient = useQueryClient();
    const [viewFilter, setViewFilter] = useState<SettlementViewFilter>('released');
    const grouped = useAdminCreditSettlementsGrouped(viewFilter);
    const releasedGrouped = useAdminCreditSettlementsGrouped('released');
    const [payingCompanyId, setPayingCompanyId] = useState<string | null>(null);
    const [paymentMethod, setPaymentMethod] = useState<'pix' | 'ted' | 'other'>('pix');
    const [paymentReference, setPaymentReference] = useState('');
    const [paymentNotes, setPaymentNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [exporting, setExporting] = useState(false);

    const companies = grouped.data?.companies ?? [];
    const releasedCompanies = releasedGrouped.data?.companies ?? [];
    const totalAwaiting = releasedCompanies.reduce((s, c) => s + Number(c.awaiting_payment_total ?? 0), 0);
    const totalRetention = companies.reduce((s, c) => s + Number(c.pending_retention_total ?? 0), 0);
    const canRegisterPayment = viewFilter === 'released' && releasedCompanies.some((c) => Number(c.awaiting_payment_total ?? 0) > 0);

    const handlePayCompany = async (company: AdminSettlementGroupedCompany) => {
        if (!paymentReference.trim()) {
            showError('Informe a referência do comprovante (PIX/TED).');
            return;
        }
        setSubmitting(true);
        setPayingCompanyId(company.company_id);
        try {
            const result = await registerAdminCreditSettlementPayment(company.company_id, {
                paymentMethod,
                paymentReference: paymentReference.trim(),
                notes: paymentNotes.trim() || undefined,
            });
            showSuccess(
                `Pagamento registrado — ${money(result.totalAmount)} (${result.settlementCount} itens). Ref.: ${result.paymentReference}`,
            );
            setPaymentReference('');
            setPaymentNotes('');
            await queryClient.invalidateQueries({ queryKey: ['adminCreditSettlementsGrouped'] });
            await queryClient.invalidateQueries({ queryKey: ['adminCreditSettlements'] });
            await queryClient.invalidateQueries({ queryKey: ['managerCreditSettlements'] });
            await queryClient.invalidateQueries({ queryKey: ['adminCreditAccounting'] });
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Erro ao registrar pagamento.');
        } finally {
            setSubmitting(false);
            setPayingCompanyId(null);
        }
    };

    const handleExport = async (status: string | null, label: string) => {
        setExporting(true);
        try {
            const rows = await fetchAdminCreditSettlementsExport(status);
            if (rows.length === 0) {
                showError(`Nenhum repasse (${label}) para exportar.`);
                return;
            }
            const slug = status ?? 'todos';
            exportCreditSettlementsCsv(rows, `repasses-credito-eventfest-${slug}`);
            showSuccess(`CSV exportado (${rows.length} linhas — ${label}).`);
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Erro ao exportar CSV.');
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="space-y-6">
            <Card className="bg-black border-yellow-500/30">
                <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                    <div>
                        <CardTitle className="text-white">Liquidação manual D+1 (TED / PIX)</CardTitle>
                        <CardDescription className="text-gray-400">
                            Repasses com retenção de 1 dia. Aguardando pagamento:{' '}
                            <span className="text-yellow-500 font-semibold">{money(totalAwaiting)}</span>
                            {totalRetention > 0 && (
                                <span className="ml-2 text-gray-500">
                                    · Em retenção D+1: {money(totalRetention)}
                                </span>
                            )}
                        </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                        <Button
                            type="button"
                            variant="outline"
                            disabled={exporting}
                            className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400 disabled:opacity-50"
                            onClick={() => void handleExport('released', 'aguardando pagamento')}
                        >
                            {exporting ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                                <Download className="h-4 w-4 mr-2" />
                            )}
                            CSV liberados
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={exporting}
                            className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400 disabled:opacity-50"
                            onClick={() => void handleExport('pending', 'retenção D+1')}
                        >
                            <Download className="h-4 w-4 mr-2" />
                            CSV retenção
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={exporting}
                            className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400 disabled:opacity-50"
                            onClick={() => void handleExport(null, 'todos os status')}
                        >
                            <Download className="h-4 w-4 mr-2" />
                            CSV completo
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-wrap items-end gap-4">
                        <div className="w-48">
                            <Label className="text-gray-300">Exibir</Label>
                            <Select
                                value={viewFilter}
                                onValueChange={(v) => setViewFilter(v as SettlementViewFilter)}
                            >
                                <SelectTrigger className="mt-1 bg-black border-yellow-500/30 text-white">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-black border border-yellow-500/30 text-white">
                                    <SelectItem
                                        value="released"
                                        className="text-gray-200 data-[highlighted]:bg-yellow-500/15 data-[highlighted]:text-yellow-400"
                                    >
                                        Aguardando TED/PIX
                                    </SelectItem>
                                    <SelectItem
                                        value="pending"
                                        className="text-gray-200 data-[highlighted]:bg-yellow-500/15 data-[highlighted]:text-yellow-400"
                                    >
                                        Em retenção D+1
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl">
                        <div>
                            <Label className="text-gray-300">Meio de pagamento</Label>
                            <Select
                                value={paymentMethod}
                                onValueChange={(v) => setPaymentMethod(v as 'pix' | 'ted' | 'other')}
                            >
                                <SelectTrigger className="mt-1 bg-black border-yellow-500/30 text-white">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-black border border-yellow-500/30 text-white">
                                    <SelectItem
                                        value="pix"
                                        className="text-gray-200 data-[highlighted]:bg-yellow-500/15 data-[highlighted]:text-yellow-400"
                                    >
                                        PIX
                                    </SelectItem>
                                    <SelectItem
                                        value="ted"
                                        className="text-gray-200 data-[highlighted]:bg-yellow-500/15 data-[highlighted]:text-yellow-400"
                                    >
                                        TED
                                    </SelectItem>
                                    <SelectItem
                                        value="other"
                                        className="text-gray-200 data-[highlighted]:bg-yellow-500/15 data-[highlighted]:text-yellow-400"
                                    >
                                        Outro
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="md:col-span-2">
                            <Label className="text-gray-300">Referência / comprovante *</Label>
                            <Input
                                value={paymentReference}
                                onChange={(e) => setPaymentReference(e.target.value)}
                                placeholder="ID da transação, E2E PIX, etc."
                                className="mt-1 bg-black border-yellow-500/30 text-white"
                            />
                        </div>
                        <div className="md:col-span-3">
                            <Label className="text-gray-300">Observações (opcional)</Label>
                            <Input
                                value={paymentNotes}
                                onChange={(e) => setPaymentNotes(e.target.value)}
                                placeholder="Notas internas para auditoria"
                                className="mt-1 bg-black border-yellow-500/30 text-white"
                            />
                        </div>
                    </div>

                    {viewFilter === 'pending' && (
                        <Alert className="border-amber-500/30 bg-amber-950/40">
                            <AlertTitle className="text-amber-200">Retenção D+1 — pagamento ainda não disponível</AlertTitle>
                            <AlertDescription className="text-amber-100/90 text-sm space-y-2">
                                <p>
                                    Itens nesta lista só liberam para TED/PIX após 1 dia (veja a coluna{' '}
                                    <strong>Liberação</strong>). O botão de baixa aparece no filtro{' '}
                                    <strong>Aguardando TED/PIX</strong>.
                                </p>
                                {totalAwaiting > 0 && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                                        onClick={() => setViewFilter('released')}
                                    >
                                        Ir para pagamento ({money(totalAwaiting)} liberados)
                                    </Button>
                                )}
                            </AlertDescription>
                        </Alert>
                    )}

                    {viewFilter === 'released' && (
                        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4 space-y-3">
                            <p className="text-gray-300 text-sm">
                                1. Faça o PIX/TED no banco · 2. Preencha comprovante acima · 3. Clique em{' '}
                                <strong className="text-yellow-500">Confirmar pagamento e baixar</strong>
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {releasedCompanies
                                    .filter((c) => Number(c.awaiting_payment_total ?? 0) > 0)
                                    .map((company) => (
                                        <Button
                                            key={company.company_id}
                                            type="button"
                                            disabled={submitting || !paymentReference.trim()}
                                            className="bg-yellow-500 text-black hover:bg-yellow-600 disabled:opacity-50"
                                            onClick={() => void handlePayCompany(company)}
                                        >
                                            {submitting && payingCompanyId === company.company_id ? (
                                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                            ) : (
                                                <CheckCircle2 className="h-4 w-4 mr-2" />
                                            )}
                                            Confirmar pagamento — {company.company_name} (
                                            {money(Number(company.awaiting_payment_total ?? 0))})
                                        </Button>
                                    ))}
                                {releasedCompanies.filter((c) => Number(c.awaiting_payment_total ?? 0) > 0).length === 0 && (
                                    <p className="text-gray-500 text-sm">Nenhum repasse liberado aguardando baixa no momento.</p>
                                )}
                            </div>
                            {!paymentReference.trim() && releasedCompanies.some((c) => Number(c.awaiting_payment_total ?? 0) > 0) && (
                                <p className="text-amber-300/90 text-xs">Informe a referência / comprovante para habilitar a baixa.</p>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>

            {grouped.isError ? (
                <Alert className="border-red-500/40 bg-red-950/40">
                    <AlertTitle className="text-red-400">Não foi possível carregar os repasses</AlertTitle>
                    <AlertDescription className="text-gray-300 text-sm space-y-3">
                        <p>{grouped.error instanceof Error ? grouped.error.message : 'Erro ao consultar o servidor.'}</p>
                        <Button
                            type="button"
                            variant="outline"
                            className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                            onClick={() => void grouped.refetch()}
                        >
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Tentar novamente
                        </Button>
                    </AlertDescription>
                </Alert>
            ) : grouped.isLoading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-yellow-500" />
                </div>
            ) : companies.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-8">
                    {viewFilter === 'released'
                        ? 'Nenhum repasse liberado aguardando pagamento.'
                        : 'Nenhum repasse em retenção D+1 no momento.'}
                </p>
            ) : (
                companies.map((company) => (
                    <Card key={company.company_id} className="bg-black border-yellow-500/30">
                        <CardHeader className="flex flex-row items-start justify-between gap-4">
                            <div>
                                <CardTitle className="text-white text-lg">{company.company_name}</CardTitle>
                                <CardDescription className="text-gray-400">
                                    {viewFilter === 'released' ? (
                                        <>
                                            A pagar:{' '}
                                            <span className="text-yellow-500 font-semibold">
                                                {money(Number(company.awaiting_payment_total ?? 0))}
                                            </span>
                                        </>
                                    ) : (
                                        <>
                                            Em retenção D+1:{' '}
                                            <span className="text-yellow-500 font-semibold">
                                                {money(Number(company.pending_retention_total ?? 0))}
                                            </span>
                                        </>
                                    )}
                                    {viewFilter === 'released' &&
                                        Number(company.pending_retention_total ?? 0) > 0 && (
                                            <span className="ml-3 text-gray-500">
                                                Em retenção D+1:{' '}
                                                {money(Number(company.pending_retention_total))}
                                            </span>
                                        )}
                                </CardDescription>
                            </div>
                            {canRegisterPayment && (
                                <Button
                                    type="button"
                                    disabled={submitting || Number(company.awaiting_payment_total ?? 0) <= 0 || !paymentReference.trim()}
                                    className="bg-yellow-500 text-black hover:bg-yellow-600 disabled:opacity-50 shrink-0"
                                    onClick={() => void handlePayCompany(company)}
                                >
                                    {submitting && payingCompanyId === company.company_id ? (
                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                    ) : (
                                        <CheckCircle2 className="h-4 w-4 mr-2" />
                                    )}
                                    Confirmar pagamento
                                </Button>
                            )}
                        </CardHeader>
                        <CardContent className="space-y-6">
                            {(company.groups ?? []).map((group) => (
                                <div key={`${company.company_id}-${group.group_key}`}>
                                    <h3 className="text-yellow-500/90 text-sm font-semibold mb-2">
                                        {groupTypeLabel(group.group_type)} — {group.group_label}{' '}
                                        <span className="text-gray-400 font-normal">
                                            (
                                            {money(
                                                (group.items ?? []).reduce(
                                                    (s, item) => s + Number(item.manager_amount ?? 0),
                                                    0,
                                                ),
                                            )}
                                            )
                                        </span>
                                    </h3>
                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow className="border-yellow-500/20">
                                                    <TableHead className="text-yellow-500">Consumo</TableHead>
                                                    <TableHead className="text-yellow-500">Descrição</TableHead>
                                                    <TableHead className="text-yellow-500 text-right">Bruto</TableHead>
                                                    <TableHead className="text-yellow-500 text-right">Comissão</TableHead>
                                                    <TableHead className="text-yellow-500 text-right">Líquido</TableHead>
                                                    <TableHead className="text-yellow-500">Liberação</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {(group.items ?? []).map((item: ManagerSettlementRow) => (
                                                    <TableRow key={item.id} className="border-yellow-500/10">
                                                        <TableCell className="text-gray-400 text-xs whitespace-nowrap">
                                                            {dt(item.spend_at)}
                                                        </TableCell>
                                                        <TableCell
                                                            className="text-gray-300 text-xs max-w-[16rem] truncate"
                                                            title={item.spend_description ?? undefined}
                                                        >
                                                            {item.spend_description ?? '—'}
                                                        </TableCell>
                                                        <TableCell className="text-right text-gray-400">
                                                            {money(Number(item.gross_amount ?? 0))}
                                                        </TableCell>
                                                        <TableCell className="text-right text-gray-500">
                                                            {money(
                                                                Number(item.gross_amount ?? 0) -
                                                                    Number(item.manager_amount ?? 0),
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-right text-yellow-400 font-medium">
                                                            {money(Number(item.manager_amount ?? 0))}
                                                        </TableCell>
                                                        <TableCell className="text-gray-400 text-xs whitespace-nowrap">
                                                            {dt(item.release_at)}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                ))
            )}
        </div>
    );
};

export default AdminCreditManualSettlementsPanel;

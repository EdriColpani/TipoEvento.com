import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, Loader2, RefreshCw, Upload } from 'lucide-react';
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
import {
    SETTLEMENT_POLICY_SHORT,
    matchesSettlementFundingFilter,
    settlementFundingDelayHint,
    settlementFundingLabel,
    type SettlementFundingFilter,
} from '@/utils/settlement-funding-labels';
import {
    assertSettlementProofFile,
    removeSettlementPaymentProof,
    uploadSettlementPaymentProof,
} from '@/utils/settlement-payment-proof';
import { showError, showSuccess } from '@/utils/toast';
import AdminCreditSettlementsHistoryPanel from '@/components/AdminCreditSettlementsHistoryPanel';

function money(v: number): string {
    return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dt(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('pt-BR');
}

function hasBankOrPix(bank: AdminSettlementGroupedCompany['payout_bank']): boolean {
    return Boolean(bank?.pix_key?.trim() || bank?.bank_name?.trim());
}

function PayoutBankBlock({
    bank,
}: {
    bank: AdminSettlementGroupedCompany['payout_bank'];
}) {
    const isMercadoPago =
        bank?.payout_mode === 'mercado_pago' ||
        (Boolean(bank?.mp_configured) && !hasBankOrPix(bank));

    if (isMercadoPago) {
        return (
            <p className="text-cyan-200/90 text-xs mt-2">
                Conta conectada: Mercado Pago
            </p>
        );
    }

    if (!hasBankOrPix(bank)) {
        return (
            <p className="text-amber-200/90 text-xs mt-2">
                Empresa sem conta de recebimento cadastrada.
            </p>
        );
    }

    return (
        <div className="mt-3 rounded-lg border border-yellow-500/20 bg-black/50 p-3 text-xs text-gray-300 space-y-1">
            <p className="text-yellow-500 font-medium">Dados para PIX/TED</p>
            {bank?.holder_name && <p>Titular: {bank.holder_name}</p>}
            {bank?.bank_name && (
                <p>
                    Banco: {bank.bank_name}
                    {bank.bank_code ? ` (${bank.bank_code})` : ''} · Ag {bank.agency} · Cc{' '}
                    {bank.account_number}
                    {bank.account_digit ? `-${bank.account_digit}` : ''}
                </p>
            )}
            {bank?.pix_key && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span>
                        PIX ({bank.pix_key_type ?? 'chave'}):{' '}
                        <span className="text-yellow-400 font-mono">{bank.pix_key}</span>
                    </span>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                        onClick={() => {
                            void navigator.clipboard.writeText(String(bank.pix_key));
                            showSuccess('Chave PIX copiada.');
                        }}
                    >
                        Copiar PIX
                    </Button>
                </div>
            )}
        </div>
    );
}

function groupTypeLabel(t: string): string {
    if (t === 'event') return 'Evento';
    if (t === 'establishment') return 'Estabelecimento parceiro';
    return 'Empresa';
}

type SettlementViewFilter = 'released' | 'pending' | 'history';

type AdminCreditManualSettlementsPanelProps = {
    companies?: Array<{ id: string; name: string }>;
};

const AdminCreditManualSettlementsPanel: React.FC<AdminCreditManualSettlementsPanelProps> = ({
    companies: companyOptions = [],
}) => {
    const queryClient = useQueryClient();
    const [viewFilter, setViewFilter] = useState<SettlementViewFilter>('released');
    const [fundingFilter, setFundingFilter] = useState<SettlementFundingFilter>('all');
    const showOperationalList = viewFilter !== 'history';
    const grouped = useAdminCreditSettlementsGrouped(viewFilter === 'pending' ? 'pending' : 'released', {
        enabled: showOperationalList,
    });
    const releasedGrouped = useAdminCreditSettlementsGrouped('released', {
        enabled: showOperationalList,
    });
    const [payingCompanyId, setPayingCompanyId] = useState<string | null>(null);
    const [paymentMethod, setPaymentMethod] = useState<'pix' | 'ted' | 'other'>('pix');
    const [paymentReference, setPaymentReference] = useState('');
    const [paymentNotes, setPaymentNotes] = useState('');
    const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [exporting, setExporting] = useState(false);

    const companiesRaw = grouped.data?.companies ?? [];
    const companies = useMemo(() => {
        if (fundingFilter === 'all') return companiesRaw;
        return companiesRaw
            .map((company) => ({
                ...company,
                groups: (company.groups ?? [])
                    .map((group) => ({
                        ...group,
                        items: (group.items ?? []).filter((item) =>
                            matchesSettlementFundingFilter(item.settlement_funding_type, fundingFilter),
                        ),
                    }))
                    .filter((group) => (group.items ?? []).length > 0),
            }))
            .filter((company) => (company.groups ?? []).length > 0);
    }, [companiesRaw, fundingFilter]);
    const releasedCompanies = releasedGrouped.data?.companies ?? [];
    const totalAwaiting = releasedCompanies.reduce((s, c) => s + Number(c.awaiting_payment_total ?? 0), 0);
    const totalRetention = companies.reduce((s, c) => s + Number(c.pending_retention_total ?? 0), 0);
    const canRegisterPayment = viewFilter === 'released' && releasedCompanies.some((c) => Number(c.awaiting_payment_total ?? 0) > 0);

    const handlePayCompany = async (company: AdminSettlementGroupedCompany) => {
        if (!paymentReference.trim()) {
            showError('Informe a referência do comprovante (PIX/TED).');
            return;
        }
        if (!paymentProofFile) {
            showError('Anexe a imagem ou PDF do comprovante de transferência.');
            return;
        }

        setSubmitting(true);
        setPayingCompanyId(company.company_id);
        let uploadedPath: string | null = null;
        try {
            assertSettlementProofFile(paymentProofFile);
            const uploaded = await uploadSettlementPaymentProof(
                company.company_id,
                paymentProofFile,
            );
            uploadedPath = uploaded.path;

            const result = await registerAdminCreditSettlementPayment(company.company_id, {
                paymentMethod,
                paymentReference: paymentReference.trim(),
                notes: paymentNotes.trim() || undefined,
                paymentProofPath: uploaded.path,
                paymentProofFileName: uploaded.fileName,
            });
            showSuccess(
                `Pagamento registrado — ${money(result.totalAmount)} (${result.settlementCount} itens). Ref.: ${result.paymentReference}`,
            );
            setPaymentReference('');
            setPaymentNotes('');
            setPaymentProofFile(null);
            await queryClient.invalidateQueries({ queryKey: ['adminCreditSettlementsGrouped'] });
            await queryClient.invalidateQueries({ queryKey: ['adminCreditSettlements'] });
            await queryClient.invalidateQueries({ queryKey: ['managerCreditSettlements'] });
            await queryClient.invalidateQueries({ queryKey: ['adminCreditAccounting'] });
        } catch (e: unknown) {
            if (uploadedPath) {
                await removeSettlementPaymentProof(uploadedPath);
            }
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
                        <CardTitle className="text-white">Liquidação manual (TED / PIX)</CardTitle>
                        <CardDescription className="text-gray-400">
                            Crédito EventFest e ingressos em modo banco. {SETTLEMENT_POLICY_SHORT}. Aguardando
                            pagamento:{' '}
                            <span className="text-yellow-500 font-semibold">{money(totalAwaiting)}</span>
                            {totalRetention > 0 && (
                                <span className="ml-2 text-gray-500">
                                    · Em retenção: {money(totalRetention)}
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
                            onClick={() => void handleExport('pending', 'em retenção')}
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
                                        Em retenção
                                    </SelectItem>
                                    <SelectItem
                                        value="history"
                                        className="text-gray-200 data-[highlighted]:bg-yellow-500/15 data-[highlighted]:text-yellow-400"
                                    >
                                        Conferência / histórico
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="w-56">
                            <Label className="text-gray-300">Meio da venda</Label>
                            <Select
                                value={fundingFilter}
                                onValueChange={(v) => setFundingFilter(v as SettlementFundingFilter)}
                            >
                                <SelectTrigger className="mt-1 bg-black border-yellow-500/30 text-white">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-black border border-yellow-500/30 text-white">
                                    <SelectItem
                                        value="all"
                                        className="text-gray-200 data-[highlighted]:bg-yellow-500/15 data-[highlighted]:text-yellow-400"
                                    >
                                        Todos
                                    </SelectItem>
                                    <SelectItem
                                        value="fast"
                                        className="text-gray-200 data-[highlighted]:bg-yellow-500/15 data-[highlighted]:text-yellow-400"
                                    >
                                        PIX / débito
                                    </SelectItem>
                                    <SelectItem
                                        value="card"
                                        className="text-gray-200 data-[highlighted]:bg-yellow-500/15 data-[highlighted]:text-yellow-400"
                                    >
                                        Cartão de crédito
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    {showOperationalList && (
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
                            <Label className="text-gray-300">Referência / ID da transferência *</Label>
                            <Input
                                value={paymentReference}
                                onChange={(e) => setPaymentReference(e.target.value)}
                                placeholder="ID da transação, E2E PIX, etc."
                                className="mt-1 bg-black border-yellow-500/30 text-white"
                            />
                        </div>
                        <div className="md:col-span-3">
                            <Label className="text-gray-300">Comprovante (imagem ou PDF) *</Label>
                            <div className="mt-1 flex flex-col sm:flex-row sm:items-center gap-3">
                                <Input
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,.pdf,.jpg,.jpeg,.png,.webp,.gif"
                                    className="bg-black border-yellow-500/30 text-white file:mr-3 file:rounded file:border-0 file:bg-yellow-500 file:px-3 file:py-1 file:text-sm file:font-medium file:text-black"
                                    onChange={(e) => {
                                        const file = e.target.files?.[0] ?? null;
                                        if (!file) {
                                            setPaymentProofFile(null);
                                            return;
                                        }
                                        try {
                                            assertSettlementProofFile(file);
                                            setPaymentProofFile(file);
                                        } catch (err) {
                                            setPaymentProofFile(null);
                                            e.target.value = '';
                                            showError(
                                                err instanceof Error
                                                    ? err.message
                                                    : 'Arquivo de comprovante inválido.',
                                            );
                                        }
                                    }}
                                />
                                {paymentProofFile ? (
                                    <p className="text-xs text-yellow-400 flex items-center gap-1">
                                        <Upload className="h-3.5 w-3.5" />
                                        {paymentProofFile.name}
                                    </p>
                                ) : (
                                    <p className="text-xs text-gray-500">Obrigatório em cada baixa (máx. 10 MB).</p>
                                )}
                            </div>
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
                    )}

                    {viewFilter === 'pending' && (
                        <Alert className="border-amber-500/30 bg-amber-950/40">
                            <AlertTitle className="text-amber-200">Em retenção — pagamento ainda não disponível</AlertTitle>
                            <AlertDescription className="text-amber-100/90 text-sm space-y-2">
                                <p>
                                    Itens nesta lista só liberam para TED/PIX na data da coluna{' '}
                                    <strong>Liberação</strong> ({SETTLEMENT_POLICY_SHORT}). O botão de baixa aparece no
                                    filtro <strong>Aguardando TED/PIX</strong>.
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
                                1. Faça o PIX/TED no banco · 2. Anexe o comprovante e a referência · 3. Clique em{' '}
                                <strong className="text-yellow-500">Confirmar pagamento</strong>
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {releasedCompanies
                                    .filter((c) => Number(c.awaiting_payment_total ?? 0) > 0)
                                    .map((company) => (
                                        <Button
                                            key={company.company_id}
                                            type="button"
                                            disabled={
                                                submitting ||
                                                !paymentReference.trim() ||
                                                !paymentProofFile
                                            }
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
                            {(!paymentReference.trim() || !paymentProofFile) &&
                                releasedCompanies.some((c) => Number(c.awaiting_payment_total ?? 0) > 0) && (
                                <p className="text-amber-300/90 text-xs">
                                    Informe a referência e anexe o comprovante (imagem/PDF) para habilitar a baixa.
                                </p>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>

            {viewFilter === 'history' ? (
                <AdminCreditSettlementsHistoryPanel companies={companyOptions} />
            ) : grouped.isError ? (
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
                        : 'Nenhum repasse em retenção no momento.'}
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
                                            Em retenção:{' '}
                                            <span className="text-yellow-500 font-semibold">
                                                {money(Number(company.pending_retention_total ?? 0))}
                                            </span>
                                        </>
                                    )}
                                    {viewFilter === 'released' &&
                                        Number(company.pending_retention_total ?? 0) > 0 && (
                                            <span className="ml-3 text-gray-500">
                                                Em retenção:{' '}
                                                {money(Number(company.pending_retention_total))}
                                            </span>
                                        )}
                                    <PayoutBankBlock bank={company.payout_bank} />
                                </CardDescription>
                            </div>
                            {canRegisterPayment && (
                                <Button
                                    type="button"
                                    disabled={
                                        submitting ||
                                        Number(company.awaiting_payment_total ?? 0) <= 0 ||
                                        !paymentReference.trim() ||
                                        !paymentProofFile
                                    }
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
                                                    <TableHead className="text-yellow-500">Origem</TableHead>
                                                    <TableHead className="text-yellow-500">Meio</TableHead>
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
                                                        <TableCell className="text-yellow-500/90 text-xs whitespace-nowrap">
                                                            {item.source_type === 'ticket' ? 'Ingresso' : 'Crédito'}
                                                        </TableCell>
                                                        <TableCell className="text-gray-300 text-xs whitespace-nowrap">
                                                            <div>{settlementFundingLabel(item.settlement_funding_type)}</div>
                                                            <div className="text-gray-500 text-[10px]">
                                                                {settlementFundingDelayHint(
                                                                    item.settlement_funding_type,
                                                                    item.settlement_delay_days,
                                                                )}
                                                            </div>
                                                        </TableCell>
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
                                                                Number(
                                                                    item.platform_amount ??
                                                                        Number(item.gross_amount ?? 0) -
                                                                            Number(item.manager_amount ?? 0),
                                                                ),
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

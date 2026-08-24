import React, { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react';
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
    type CreditAccountingFilters,
    type CreditAccountingRow,
    type CreditAccountingSummary,
    fetchAdminCreditAccountingExport,
    fetchManagerCreditAccountingExport,
    useAdminCreditAccountingReport,
    useManagerCreditAccountingReport,
} from '@/hooks/use-credit-reports';
import { exportCreditAccountingCsv } from '@/utils/export-credit-accounting-csv';
import { showError, showSuccess } from '@/utils/toast';

function money(v: number | null | undefined): string {
    return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dt(iso: string): string {
    return new Date(iso).toLocaleString('pt-BR');
}

const ROW_KIND_LABELS: Record<string, string> = {
    topup_origin: 'Recarga de crédito (Mercado Pago)',
    topup: 'Recarga de crédito (Mercado Pago)',
    spend_received: 'Consumo (crédito EventFest)',
    spend: 'Consumo (crédito EventFest)',
    spend_ticket: 'Ingresso (crédito EventFest)',
    spend_consumption: 'Consumo (crédito EventFest)',
    ticket_sale_mp: 'Ingresso (Mercado Pago — split automático)',
    ticket_sale_d1: 'Ingresso (Mercado Pago — caixa EventFest)',
    refund: 'Estorno de crédito',
    settlement_paid: 'Repasse manual EventFest → gestor (crédito)',
    ticket_settlement_paid: 'Repasse manual EventFest → gestor (ingresso)',
};

const SETTLEMENT_STATUS_LABELS: Record<string, string> = {
    pending_d1: 'Em retenção',
    awaiting_manual_payment: 'Aguardando TED/PIX',
    paid_manual: 'Pago (manual PIX/TED)',
    clawback: 'Clawback',
    caixa_eventfest: 'Caixa EventFest',
    caixa_eventfest_d1: 'Caixa EventFest (modo banco)',
    mp_split_automatico: 'Transferência automática (split MP)',
};

function settlementStatusLabel(status: string | null | undefined): string {
    if (!status) return '—';
    return SETTLEMENT_STATUS_LABELS[status] ?? status;
}

function kindLabel(kind: string): string {
    return ROW_KIND_LABELS[kind] ?? kind;
}

type CompanyOption = { id: string; name: string };

type CreditAccountingReportPanelProps = {
    mode: 'manager' | 'admin';
    companyId?: string;
    companies?: CompanyOption[];
};

const CreditAccountingReportPanel: React.FC<CreditAccountingReportPanelProps> = ({
    mode,
    companyId,
    companies = [],
}) => {
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [companyFilter, setCompanyFilter] = useState<string>('all');
    const [exporting, setExporting] = useState(false);

    const filters: CreditAccountingFilters = useMemo(
        () => ({
            startDate: startDate || null,
            endDate: endDate || null,
            companyId: mode === 'admin' && companyFilter !== 'all' ? companyFilter : null,
        }),
        [startDate, endDate, companyFilter, mode],
    );

    const managerQuery = useManagerCreditAccountingReport(
        mode === 'manager' ? companyId : undefined,
        filters,
    );
    const adminQuery = useAdminCreditAccountingReport(mode === 'admin' ? filters : { });

    const query = mode === 'manager' ? managerQuery : adminQuery;
    const items = query.data?.items ?? [];
    const summary = query.data?.summary;

    const managerBlocked = mode === 'manager' && !companyId;

    const handleExport = async () => {
        if (mode === 'manager' && !companyId) return;
        setExporting(true);
        try {
            const rows =
                mode === 'manager'
                    ? await fetchManagerCreditAccountingExport(companyId!, filters)
                    : await fetchAdminCreditAccountingExport(filters);
            if (rows.length === 0) {
                showError('Nenhuma linha para exportar no período.');
                return;
            }
            const prefix =
                mode === 'manager'
                    ? 'relatorio-contabil-gestor-creditos'
                    : 'relatorio-contabil-admin-creditos';
            exportCreditAccountingCsv(rows, prefix);
            showSuccess(`CSV exportado (${rows.length} linhas).`);
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Erro ao exportar CSV.');
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="space-y-6">
            <Card className="bg-black border-yellow-500/30">
                <CardHeader>
                    <CardTitle className="text-white text-lg flex items-center gap-2">
                        <FileSpreadsheet className="h-5 w-5 text-yellow-500" />
                        Filtros
                    </CardTitle>
                    <CardDescription className="text-gray-400">
                        {mode === 'manager'
                            ? 'Livro de movimentos da empresa: recargas, ingressos, consumo, taxas MP, comissão EventFest e repasses.'
                            : 'Livro contábil da rede: entradas do cliente, taxas Mercado Pago, comissão EventFest, split automático e repasses manuais ao gestor.'}
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-4 items-end">
                    <div>
                        <Label className="text-gray-400 text-xs">Data inicial</Label>
                        <Input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="bg-black border-yellow-500/30 text-white mt-1 w-40"
                        />
                    </div>
                    <div>
                        <Label className="text-gray-400 text-xs">Data final</Label>
                        <Input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="bg-black border-yellow-500/30 text-white mt-1 w-40"
                        />
                    </div>
                    {mode === 'admin' && companies.length > 0 && (
                        <div className="min-w-[220px]">
                            <Label className="text-gray-400 text-xs">Empresa</Label>
                            <Select value={companyFilter} onValueChange={setCompanyFilter}>
                                <SelectTrigger className="bg-black/60 border-yellow-500/30 text-white mt-1">
                                    <SelectValue placeholder="Todas" />
                                </SelectTrigger>
                                <SelectContent className="bg-black border-yellow-500/30 text-white">
                                    <SelectItem
                                        value="all"
                                        className="text-white focus:bg-yellow-500/10 focus:text-yellow-400"
                                    >
                                        Todas as empresas
                                    </SelectItem>
                                    {companies.map((c) => (
                                        <SelectItem
                                            key={c.id}
                                            value={c.id}
                                            className="text-white focus:bg-yellow-500/10 focus:text-yellow-400"
                                        >
                                            {c.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                    <Button
                        variant="outline"
                        className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400 disabled:opacity-50"
                        disabled={exporting || query.isLoading}
                        onClick={handleExport}
                    >
                        {exporting ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                            <Download className="h-4 w-4 mr-2" />
                        )}
                        Exportar CSV (contador)
                    </Button>
                </CardContent>
            </Card>

            {managerBlocked && (
                <p className="text-amber-400 text-sm border border-amber-500/30 rounded-lg p-3 bg-amber-500/5">
                    Empresa do gestor não identificada. Verifique o vínculo em Perfil da Empresa.
                </p>
            )}

            {summary && !managerBlocked && <SummaryCards summary={summary} mode={mode} totalShown={items.length} />}

            <Card className="bg-black border-yellow-500/30">
                <CardHeader>
                    <CardTitle className="text-white text-lg">Lançamentos</CardTitle>
                    {summary?.total_rows != null && summary.total_rows > items.length && (
                        <CardDescription className="text-gray-500 text-xs">
                            Exibindo {items.length} de {summary.total_rows} — use Exportar CSV para o arquivo completo.
                        </CardDescription>
                    )}
                </CardHeader>
                <CardContent className="overflow-x-auto">
                    {managerBlocked ? (
                        <p className="text-gray-500 text-sm text-center py-8">Vincule uma empresa para carregar os lançamentos.</p>
                    ) : query.isLoading ? (
                        <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto py-8" />
                    ) : query.isError ? (
                        <p className="text-red-400 text-sm text-center py-8">
                            Erro ao carregar relatório contábil.
                            {query.error instanceof Error ? ` ${query.error.message}` : ''}
                        </p>
                    ) : items.length === 0 ? (
                        <p className="text-gray-500 text-sm text-center py-8">Nenhum lançamento no período.</p>
                    ) : (
                        <AccountingTable rows={items} mode={mode} />
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

function SummaryCards({
    summary,
    mode,
    totalShown,
}: {
    summary: CreditAccountingSummary;
    mode: 'manager' | 'admin';
    totalShown: number;
}) {
    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <MiniStat label="Recargas crédito" value={String(summary.topup_count ?? 0)} sub={money(summary.topup_gross)} />
            <MiniStat label="Ingressos MP" value={String(summary.ticket_sale_count ?? 0)} sub={money(summary.ticket_sale_gross)} />
            <MiniStat label="Taxas Mercado Pago" value={money(summary.topup_mp_fees)} />
            <MiniStat label="Consumos crédito" value={String(summary.spend_count ?? 0)} sub={money(summary.spend_gross)} />
            <MiniStat label="Comissão EventFest" value={money(summary.platform_commission)} />
            <MiniStat label="Líq. gestores" value={money(summary.manager_net)} />
            <MiniStat
                label="Repasses manuais"
                value={String(summary.settlement_paid_count ?? 0)}
                sub={money(summary.settlement_paid_total)}
            />
            {mode === 'admin' && summary.refund_count != null && summary.refund_count > 0 ? (
                <MiniStat label="Estornos" value={String(summary.refund_count)} sub={money(summary.refund_total)} />
            ) : (
                <MiniStat label="Cross-empresa" value={String(summary.cross_spend_count ?? 0)} />
            )}
            <MiniStat label="Linhas (tela)" value={String(totalShown)} sub={summary.total_rows ? `Total: ${summary.total_rows}` : undefined} />
        </div>
    );
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
        <Card className="bg-black border-yellow-500/20">
            <CardContent className="pt-4 pb-3">
                <p className="text-gray-500 text-xs">{label}</p>
                <p className="text-yellow-500 font-semibold text-sm mt-0.5">{value}</p>
                {sub && <p className="text-gray-400 text-xs mt-0.5">{sub}</p>}
            </CardContent>
        </Card>
    );
}

function commissionCell(row: CreditAccountingRow): string {
    const kind = row.row_kind;
    const isSpend =
        kind === 'spend' ||
        kind === 'spend_ticket' ||
        kind === 'spend_consumption' ||
        kind === 'spend_received' ||
        kind === 'ticket_sale_mp' ||
        kind === 'ticket_sale_d1';
    if (!isSpend) return '—';
    return money(row.platform_amount);
}

function commissionTitle(row: CreditAccountingRow): string | undefined {
    const kind = row.row_kind;
    if (kind === 'topup' || kind === 'topup_origin') {
        return 'Recarga não tem comissão EventFest. A taxa cobrada aqui é só a do Mercado Pago.';
    }
    if (kind === 'settlement_paid' || kind === 'ticket_settlement_paid') {
        return 'Repasse transfere o líquido já líquido. A comissão EventFest está na linha de consumo/ingresso.';
    }
    if (
        (kind === 'spend' || kind === 'spend_ticket' || kind === 'spend_consumption' || kind === 'spend_received') &&
        Number(row.platform_amount ?? 0) === 0 &&
        Number(row.gross_amount ?? 0) > 0
    ) {
        return 'Alíquota 6% sobre o bruto, arredondada em centavos. Em R$ 0,05 vira R$ 0,003 → R$ 0,00.';
    }
    return undefined;
}

function flowLabel(row: CreditAccountingRow): string {
    const origin = (row.origin_company_name || '').trim();
    const dest = (row.receiver_company_name || '').trim();
    if (origin && dest) return `${origin} → ${dest}`;
    if (origin) return origin;
    if (dest) return dest;
    return '—';
}

function AccountingTable({ rows, mode }: { rows: CreditAccountingRow[]; mode: 'manager' | 'admin' }) {
    return (
        <Table>
            <TableHeader>
                <TableRow className="border-yellow-500/20">
                    <TableHead className="text-yellow-500">Data</TableHead>
                    <TableHead className="text-yellow-500">Tipo</TableHead>
                    {mode === 'admin' && <TableHead className="text-yellow-500">Empresa</TableHead>}
                    <TableHead className="text-yellow-500">Origem / Receptor</TableHead>
                    <TableHead className="text-yellow-500 text-right">Bruto</TableHead>
                    <TableHead className="text-yellow-500 text-right">Taxa MP</TableHead>
                    <TableHead className="text-yellow-500 text-right">Comissão EF</TableHead>
                    <TableHead className="text-yellow-500 text-right">Líquido gestor</TableHead>
                    <TableHead className="text-yellow-500">Liquidação</TableHead>
                    <TableHead className="text-yellow-500">Descrição</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {rows.map((row) => (
                    <TableRow key={`${row.row_kind}-${row.reference_id}`} className="border-yellow-500/10">
                        <TableCell className="text-gray-400 text-xs whitespace-nowrap">{dt(row.transaction_at)}</TableCell>
                        <TableCell className="text-gray-200 text-xs max-w-[200px]">{kindLabel(row.row_kind)}</TableCell>
                        {mode === 'admin' && (
                            <TableCell className="text-gray-300 text-xs max-w-[140px] truncate" title={row.company_name ?? ''}>
                                {row.company_name ?? '—'}
                            </TableCell>
                        )}
                        <TableCell className="text-gray-200 text-xs max-w-[260px]" title={flowLabel(row)}>
                            {flowLabel(row)}
                            {row.is_cross_company && (
                                <span className="text-yellow-600 ml-1">(cross)</span>
                            )}
                        </TableCell>
                        <TableCell className="text-right text-gray-300 text-xs">{money(row.gross_amount)}</TableCell>
                        <TableCell className="text-right text-gray-400 text-xs">{money(row.mp_fee_amount)}</TableCell>
                        <TableCell
                            className="text-right text-gray-400 text-xs"
                            title={commissionTitle(row)}
                        >
                            {commissionCell(row)}
                        </TableCell>
                        <TableCell className="text-right text-yellow-400 text-xs">{money(row.manager_amount)}</TableCell>
                        <TableCell className="text-gray-400 text-xs">
                            {settlementStatusLabel(row.disbursement_status)}
                            {row.mp_transfer_id && (
                                <span className="block text-gray-500 font-mono truncate max-w-[8rem]" title={row.mp_transfer_id}>
                                    {row.mp_transfer_id}
                                </span>
                            )}
                        </TableCell>
                        <TableCell className="text-gray-500 text-xs max-w-[220px] truncate" title={row.public_description ?? ''}>
                            {row.public_description || row.event_title || '—'}
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}

export default CreditAccountingReportPanel;

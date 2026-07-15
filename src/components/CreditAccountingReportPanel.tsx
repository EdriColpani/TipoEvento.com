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
    topup_origin: 'Recarga (origem)',
    topup: 'Recarga',
    spend_received: 'Consumo',
    spend: 'Consumo',
    refund: 'Estorno',
    settlement_paid: 'Repasse liquidado (manual)',
};

const SETTLEMENT_STATUS_LABELS: Record<string, string> = {
    pending_d1: 'Retenção D+1',
    awaiting_manual_payment: 'Aguardando TED/PIX',
    paid_manual: 'Pago (manual)',
    clawback: 'Clawback',
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
                            ? 'Recargas originadas na sua empresa e consumos recebidos (ingresso + PDV).'
                            : 'Todas as recargas, consumos e estornos da rede EventFest.'}
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
            <MiniStat label="Recargas" value={String(summary.topup_count ?? 0)} sub={money(summary.topup_gross)} />
            <MiniStat label="Taxas MP (recargas)" value={money(summary.topup_mp_fees)} />
            <MiniStat label="Consumos" value={String(summary.spend_count ?? 0)} sub={money(summary.spend_gross)} />
            <MiniStat label="Comissão EF" value={money(summary.platform_commission)} />
            <MiniStat label="Líq. gestores" value={money(summary.manager_net)} />
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

function AccountingTable({ rows, mode }: { rows: CreditAccountingRow[]; mode: 'manager' | 'admin' }) {
    return (
        <Table>
            <TableHeader>
                <TableRow className="border-yellow-500/20">
                    <TableHead className="text-yellow-500">Data</TableHead>
                    <TableHead className="text-yellow-500">Tipo</TableHead>
                    {mode === 'admin' && <TableHead className="text-yellow-500">Empresa</TableHead>}
                    <TableHead className="text-yellow-500">Origem → Receptor</TableHead>
                    <TableHead className="text-yellow-500 text-right">Bruto</TableHead>
                    <TableHead className="text-yellow-500 text-right">Comissão</TableHead>
                    <TableHead className="text-yellow-500 text-right">Líquido</TableHead>
                    <TableHead className="text-yellow-500">Repasse</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {rows.map((row) => (
                    <TableRow key={`${row.row_kind}-${row.reference_id}`} className="border-yellow-500/10">
                        <TableCell className="text-gray-400 text-xs whitespace-nowrap">{dt(row.transaction_at)}</TableCell>
                        <TableCell className="text-gray-200 text-xs">{kindLabel(row.row_kind)}</TableCell>
                        {mode === 'admin' && (
                            <TableCell className="text-gray-300 text-xs max-w-[140px] truncate" title={row.company_name ?? ''}>
                                {row.company_name ?? '—'}
                            </TableCell>
                        )}
                        <TableCell className="text-gray-400 text-xs max-w-[180px] truncate">
                            {row.row_kind.includes('topup')
                                ? row.origin_company_name ?? '—'
                                : `${row.origin_company_name ?? '?'} → ${row.receiver_company_name ?? '?'}`}
                            {row.is_cross_company && (
                                <span className="text-yellow-600 ml-1">(cross)</span>
                            )}
                        </TableCell>
                        <TableCell className="text-right text-gray-300 text-xs">{money(row.gross_amount)}</TableCell>
                        <TableCell className="text-right text-gray-400 text-xs">{money(row.platform_amount)}</TableCell>
                        <TableCell className="text-right text-yellow-400 text-xs">{money(row.manager_amount)}</TableCell>
                        <TableCell className="text-gray-500 text-xs">
                            {settlementStatusLabel(row.disbursement_status)}
                            {row.mp_transfer_id && (
                                <span className="block text-gray-600 font-mono truncate max-w-[8rem]" title={row.mp_transfer_id}>
                                    {row.mp_transfer_id}
                                </span>
                            )}
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}

export default CreditAccountingReportPanel;

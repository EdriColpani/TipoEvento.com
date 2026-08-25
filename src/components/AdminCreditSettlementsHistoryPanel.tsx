import React, { useMemo, useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
    useAdminCreditSettlements,
    useAdminCreditSettlementsGrouped,
    type AdminSettlementRow,
} from '@/hooks/use-credit-reports';
import { downloadSettlementPaymentProof } from '@/utils/settlement-payment-proof';
import {
    settlementFundingDelayHint,
    settlementFundingLabel,
    settlementStatusLabel,
} from '@/utils/settlement-funding-labels';
import { sumSettlementItemsByFunding } from '@/utils/settlement-funding-totals';
import { showError, showSuccess } from '@/utils/toast';

function money(v: number): string {
    return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dt(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('pt-BR');
}

type StatusFilter = 'all' | 'paid' | 'released' | 'pending' | 'clawback';

type CompanyOption = { id: string; name: string };

type AdminCreditSettlementsHistoryPanelProps = {
    companies?: CompanyOption[];
};

/** Conferência em tela: todos os repasses (incl. pagos), filtro por gestor/status. */
const AdminCreditSettlementsHistoryPanel: React.FC<AdminCreditSettlementsHistoryPanelProps> = ({
    companies: companiesProp = [],
}) => {
    const [companyId, setCompanyId] = useState<string>('all');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('paid');
    const [downloadingPath, setDownloadingPath] = useState<string | null>(null);

    const rpcStatus = statusFilter === 'all' ? null : statusFilter;
    const rpcCompanyId = companyId === 'all' ? null : companyId;

    /** Catálogo: empresas que têm ao menos um lançamento no ledger de repasse. */
    const companyCatalog = useAdminCreditSettlementsGrouped(null, { enabled: true });
    const listQuery = useAdminCreditSettlements(null, null, { enabled: true });

    const companyOptions = useMemo(() => {
        const map = new Map<string, string>();
        for (const c of companyCatalog.data?.companies ?? []) {
            if (c.company_id) {
                map.set(c.company_id, (c.company_name || '').trim() || c.company_id);
            }
        }
        for (const row of listQuery.data?.items ?? []) {
            if (row.company_id) {
                map.set(row.company_id, (row.company_name || '').trim() || row.company_id);
            }
        }
        for (const c of companiesProp) {
            if (c.id && map.has(c.id)) {
                map.set(c.id, c.name.trim() || map.get(c.id)!);
            }
        }
        return [...map.entries()]
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
    }, [companyCatalog.data?.companies, listQuery.data?.items, companiesProp]);

    const query = useAdminCreditSettlements(rpcStatus, rpcCompanyId, { enabled: true });
    const items = query.data?.items ?? [];

    const totalsOnScreen = useMemo(() => {
        let net = 0;
        for (const row of items) {
            net += Number(row.manager_amount ?? 0);
        }
        const byFunding = sumSettlementItemsByFunding(items);
        return { net, count: items.length, byFunding };
    }, [items]);

    const destinationLabel = (row: AdminSettlementRow) => {
        if (row.event_title) return row.event_title;
        if (row.establishment_name) return row.establishment_name;
        if (row.group_label) return row.group_label;
        return '—';
    };

    const handleDownloadProof = async (path: string, fileName?: string | null) => {
        setDownloadingPath(path);
        try {
            await downloadSettlementPaymentProof(path, fileName);
            showSuccess('Comprovante aberto para download.');
        } catch (e) {
            showError(e instanceof Error ? e.message : 'Falha ao baixar comprovante.');
        } finally {
            setDownloadingPath(null);
        }
    };

    const companiesLoading = companyCatalog.isLoading && listQuery.isLoading && companyOptions.length === 0;

    return (
        <Card className="bg-black border-yellow-500/30">
            <CardHeader>
                <CardTitle className="text-white">Conferência de repasses</CardTitle>
                <CardDescription className="text-gray-400">
                    Histórico em tela (incluindo já pagos). Filtre por gestor e status — sem precisar exportar CSV.
                    Até 500 linhas mais recentes do filtro.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_13rem_auto] gap-x-4 gap-y-1 items-end">
                    <div className="min-w-0">
                        <Label className="text-gray-300">Gestor / empresa</Label>
                        <Select value={companyId} onValueChange={setCompanyId}>
                            <SelectTrigger className="mt-1 h-10 bg-black border-yellow-500/30 text-white">
                                <SelectValue placeholder="Todas" />
                            </SelectTrigger>
                            <SelectContent className="bg-black border border-yellow-500/30 text-white max-h-72">
                                <SelectItem
                                    value="all"
                                    className="text-gray-200 data-[highlighted]:bg-yellow-500/15 data-[highlighted]:text-yellow-400"
                                >
                                    Todas as empresas
                                </SelectItem>
                                {companiesLoading ? (
                                    <SelectItem value="__loading" disabled className="text-gray-500">
                                        Carregando empresas com repasse...
                                    </SelectItem>
                                ) : (
                                    companyOptions.map((c) => (
                                        <SelectItem
                                            key={c.id}
                                            value={c.id}
                                            className="text-gray-200 data-[highlighted]:bg-yellow-500/15 data-[highlighted]:text-yellow-400"
                                        >
                                            {c.name}
                                        </SelectItem>
                                    ))
                                )}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Label className="text-gray-300">Status</Label>
                        <Select
                            value={statusFilter}
                            onValueChange={(v) => setStatusFilter(v as StatusFilter)}
                        >
                            <SelectTrigger className="mt-1 h-10 bg-black border-yellow-500/30 text-white">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-black border border-yellow-500/30 text-white">
                                <SelectItem value="paid" className="text-gray-200 data-[highlighted]:bg-yellow-500/15 data-[highlighted]:text-yellow-400">
                                    Só pagos
                                </SelectItem>
                                <SelectItem value="all" className="text-gray-200 data-[highlighted]:bg-yellow-500/15 data-[highlighted]:text-yellow-400">
                                    Todos os status
                                </SelectItem>
                                <SelectItem value="released" className="text-gray-200 data-[highlighted]:bg-yellow-500/15 data-[highlighted]:text-yellow-400">
                                    Aguardando TED/PIX
                                </SelectItem>
                                <SelectItem value="pending" className="text-gray-200 data-[highlighted]:bg-yellow-500/15 data-[highlighted]:text-yellow-400">
                                    Em retenção
                                </SelectItem>
                                <SelectItem value="clawback" className="text-gray-200 data-[highlighted]:bg-yellow-500/15 data-[highlighted]:text-yellow-400">
                                    Clawback
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        className="h-10 mt-1 sm:mt-0 bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400 shrink-0"
                        onClick={() => {
                            void companyCatalog.refetch();
                            void listQuery.refetch();
                            void query.refetch();
                        }}
                        disabled={query.isFetching || companyCatalog.isFetching}
                    >
                        {query.isFetching || companyCatalog.isFetching ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                            <RefreshCw className="h-4 w-4 mr-2" />
                        )}
                        Atualizar
                    </Button>
                    <p className="text-xs sm:col-span-3 -mt-0.5">
                        {!companiesLoading && companyOptions.length === 0 ? (
                            <span className="text-amber-300/90">Nenhuma empresa com repasse encontrada.</span>
                        ) : (
                            <span className="text-gray-500">{companyOptions.length} empresa(s) com repasse</span>
                        )}
                    </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    <div className="rounded-xl border border-yellow-500/20 bg-black/40 p-3">
                        <p className="text-gray-500 text-xs">Linhas na tela</p>
                        <p className="text-yellow-500 font-semibold">{totalsOnScreen.count}</p>
                    </div>
                    <div className="rounded-xl border border-yellow-500/20 bg-black/40 p-3">
                        <p className="text-gray-500 text-xs">Soma líquido (filtro)</p>
                        <p className="text-yellow-500 font-semibold">{money(totalsOnScreen.net)}</p>
                    </div>
                    <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/30 p-3">
                        <p className="text-gray-500 text-xs">PIX/débito liberado</p>
                        <p className="text-cyan-200 font-semibold">
                            {money(totalsOnScreen.byFunding.awaitingFast)}
                        </p>
                    </div>
                    <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-3">
                        <p className="text-gray-500 text-xs">Cartão liberado</p>
                        <p className="text-yellow-400 font-semibold">
                            {money(totalsOnScreen.byFunding.awaitingCard)}
                        </p>
                    </div>
                    <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 p-3">
                        <p className="text-gray-500 text-xs">Retenção PIX/débito</p>
                        <p className="text-amber-200 font-semibold">
                            {money(totalsOnScreen.byFunding.retentionFast)}
                        </p>
                    </div>
                    <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 p-3">
                        <p className="text-gray-500 text-xs">Retenção cartão D+30</p>
                        <p className="text-amber-200 font-semibold">
                            {money(totalsOnScreen.byFunding.retentionCard)}
                        </p>
                    </div>
                </div>

                {query.isLoading ? (
                    <div className="flex justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-yellow-500" />
                    </div>
                ) : query.isError ? (
                    <p className="text-red-400 text-sm">
                        {query.error instanceof Error
                            ? query.error.message
                            : 'Erro ao carregar repasses.'}
                    </p>
                ) : items.length === 0 ? (
                    <p className="text-gray-500 text-sm text-center py-8">
                        Nenhum repasse com esses filtros.
                    </p>
                ) : (
                    <div className="overflow-x-auto max-h-[32rem]">
                        <Table>
                            <TableHeader>
                                <TableRow className="border-yellow-500/20">
                                    <TableHead className="text-yellow-500">Consumo</TableHead>
                                    <TableHead className="text-yellow-500">Gestor</TableHead>
                                    <TableHead className="text-yellow-500">Evento / destino</TableHead>
                                    <TableHead className="text-yellow-500">Meio</TableHead>
                                    <TableHead className="text-yellow-500">Status</TableHead>
                                    <TableHead className="text-yellow-500 text-right">Líquido</TableHead>
                                    <TableHead className="text-yellow-500">Liberação</TableHead>
                                    <TableHead className="text-yellow-500">Pago em</TableHead>
                                    <TableHead className="text-yellow-500">Ref.</TableHead>
                                    <TableHead className="text-yellow-500">Arquivo</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {items.map((row) => (
                                    <TableRow key={row.id} className="border-yellow-500/10">
                                        <TableCell className="text-gray-400 text-xs whitespace-nowrap">
                                            {dt(row.spend_at)}
                                        </TableCell>
                                        <TableCell
                                            className="text-gray-200 text-xs max-w-[10rem] truncate"
                                            title={row.company_name ?? undefined}
                                        >
                                            {row.company_name ?? '—'}
                                        </TableCell>
                                        <TableCell
                                            className="text-gray-300 text-xs max-w-[12rem] truncate"
                                            title={destinationLabel(row)}
                                        >
                                            {destinationLabel(row)}
                                        </TableCell>
                                        <TableCell className="text-gray-300 text-xs whitespace-nowrap">
                                            <div>{settlementFundingLabel(row.settlement_funding_type)}</div>
                                            <div className="text-gray-500 text-[10px]">
                                                {settlementFundingDelayHint(
                                                    row.settlement_funding_type,
                                                    row.settlement_delay_days,
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-gray-300 text-xs">
                                            {settlementStatusLabel(row.status)}
                                        </TableCell>
                                        <TableCell className="text-right text-yellow-400 text-xs font-medium">
                                            {money(Number(row.manager_amount ?? 0))}
                                        </TableCell>
                                        <TableCell className="text-gray-400 text-xs whitespace-nowrap">
                                            {dt(row.release_at)}
                                        </TableCell>
                                        <TableCell className="text-gray-400 text-xs whitespace-nowrap">
                                            {dt(row.paid_at)}
                                        </TableCell>
                                        <TableCell
                                            className="text-gray-500 text-xs font-mono max-w-[8rem] truncate"
                                            title={row.payment_reference ?? undefined}
                                        >
                                            {row.payment_reference ?? '—'}
                                        </TableCell>
                                        <TableCell>
                                            {row.payment_proof_path ? (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-8 bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                                                    disabled={downloadingPath === row.payment_proof_path}
                                                    onClick={() =>
                                                        void handleDownloadProof(
                                                            row.payment_proof_path!,
                                                            row.payment_proof_file_name,
                                                        )
                                                    }
                                                >
                                                    {downloadingPath === row.payment_proof_path ? (
                                                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                                                    ) : (
                                                        <Download className="h-3.5 w-3.5 mr-1" />
                                                    )}
                                                    PDF
                                                </Button>
                                            ) : (
                                                <span className="text-gray-600 text-xs">—</span>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

export default AdminCreditSettlementsHistoryPanel;

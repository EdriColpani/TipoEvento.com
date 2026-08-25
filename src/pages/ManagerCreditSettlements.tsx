import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Banknote, Download, Loader2, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { usePageAuth } from '@/hooks/use-page-auth';
import { useManagerCreditSettlements, useManagerTicketChargebackDebts, useSettlementFundingSummary } from '@/hooks/use-credit-reports';
import { useCreditReportsAccess } from '@/hooks/use-credit-reports-access';
import { SettlementFundingClarityBoard } from '@/components/settlement/SettlementFundingClarityBoard';
import { downloadSettlementPaymentProof } from '@/utils/settlement-payment-proof';
import {
    SETTLEMENT_POLICY_HELP,
    SETTLEMENT_POLICY_SHORT,
    matchesSettlementFundingFilter,
    settlementFundingDelayHint,
    settlementFundingLabel,
    settlementSourceOriginLabel,
    settlementStatusLabel,
    type SettlementFundingFilter,
} from '@/utils/settlement-funding-labels';
import { fundingTotalsFromSummary } from '@/utils/settlement-funding-totals';
import { showError, showSuccess } from '@/utils/toast';

function money(v: number): string {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dt(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('pt-BR');
}

const ManagerCreditSettlements: React.FC = () => {
    const navigate = useNavigate();
    const { userId } = usePageAuth();
    const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
    const [fundingFilter, setFundingFilter] = useState<SettlementFundingFilter>('all');

    const access = useCreditReportsAccess(userId);
    const { data, isLoading, isError, error, refetch } = useManagerCreditSettlements(access.company?.id);
    const debts = useManagerTicketChargebackDebts(access.company?.id);
    const fundingSummary = useSettlementFundingSummary(access.company?.id, !!access.company?.id);

    const summary = data?.summary;
    const policyLabel = data?.settlement_policy ?? SETTLEMENT_POLICY_SHORT;
    const items = useMemo(() => {
        const rows = data?.items ?? [];
        return rows.filter((row) =>
            matchesSettlementFundingFilter(row.settlement_funding_type, fundingFilter),
        );
    }, [data?.items, fundingFilter]);

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

    useEffect(() => {
        if (!access.isLoading && access.isAdminMaster) {
            navigate('/admin/settings/credit-reports', {
                state: { creditTab: 'settlements' },
                replace: true,
            });
        }
    }, [access.isLoading, access.isAdminMaster, navigate]);

    if (access.isLoading || access.isAdminMaster) {
        return (
            <div className="max-w-3xl mx-auto text-center py-16 text-gray-400">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-3" />
                Redirecionando para o painel Admin...
            </div>
        );
    }

    if (!access.canAccessManagerSettlements && !access.canAccessManagerCreditReports) {
        return (
            <div className="max-w-3xl mx-auto text-center py-16 text-gray-400">
                Relatório de repasses não disponível para sua conta.
                <Button variant="outline" className="mt-4 block mx-auto" onClick={() => navigate('/manager/settings')}>
                    Voltar
                </Button>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-2xl font-serif text-yellow-500 flex items-center gap-2">
                        <Banknote className="h-6 w-6" />
                        Repasses — Crédito e ingressos (modo banco)
                    </h1>
                    <p className="text-gray-400 text-sm mt-1">
                        {policyLabel}. {SETTLEMENT_POLICY_HELP} Após a liberação, a EventFest liquida via TED/PIX.
                    </p>
                </div>
                <Button
                    variant="outline"
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                    onClick={() => navigate('/manager/reports')}
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                </Button>
            </div>

            <SettlementFundingClarityBoard
                audience="manager"
                totals={fundingTotalsFromSummary(fundingSummary.data)}
                paidTotal={Number(summary?.paid ?? 0)}
                clawbackTotal={Number(summary?.clawback ?? 0)}
                loading={fundingSummary.isLoading || isLoading}
            />

            {(debts.data ?? []).some((d) => d.status === 'open' || d.status === 'partial') && (
                <Alert className="mb-6 border-amber-500/40 bg-amber-950/40">
                    <AlertTitle className="text-amber-200">Descontos de chargeback de ingresso</AlertTitle>
                    <AlertDescription className="text-gray-300 text-sm">
                        Há valores de chargeback de ingresso a descontar automaticamente nos próximos repasses liquidados
                        pela EventFest. Veja o detalhe abaixo.
                    </AlertDescription>
                </Alert>
            )}

            {(debts.data ?? []).length > 0 && (
                <Card className="bg-black border-yellow-500/30 mb-6">
                    <CardHeader>
                        <CardTitle className="text-white">Chargebacks de ingresso (dívidas / descontos)</CardTitle>
                        <CardDescription className="text-gray-400">
                            Registrados quando o Mercado Pago avisa chargeback/estorno de uma venda de ingresso.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                        {debts.isLoading ? (
                            <Loader2 className="h-6 w-6 animate-spin text-yellow-500 mx-auto" />
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-yellow-500/20">
                                        <TableHead className="text-yellow-500">Data</TableHead>
                                        <TableHead className="text-yellow-500">Evento</TableHead>
                                        <TableHead className="text-yellow-500">Status</TableHead>
                                        <TableHead className="text-yellow-500 text-right">Devido</TableHead>
                                        <TableHead className="text-yellow-500 text-right">Já descontado</TableHead>
                                        <TableHead className="text-yellow-500 text-right">Restante</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {debts.data!.map((row) => (
                                        <TableRow key={row.id} className="border-yellow-500/10">
                                            <TableCell className="text-gray-400 text-xs whitespace-nowrap">{dt(row.created_at)}</TableCell>
                                            <TableCell className="text-gray-300 text-xs max-w-[14rem] truncate">
                                                {row.event_title ?? '—'}
                                            </TableCell>
                                            <TableCell className="text-gray-300 text-sm">{row.status}</TableCell>
                                            <TableCell className="text-right text-gray-400">{money(Number(row.amount_due))}</TableCell>
                                            <TableCell className="text-right text-gray-500">{money(Number(row.amount_applied))}</TableCell>
                                            <TableCell className="text-right text-amber-300 font-medium">
                                                {money(Number(row.amount_remaining))}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>
            )}

            <Card className="bg-black border-yellow-500/30">
                <CardHeader>
                    <CardTitle className="text-white">Extrato de repasses</CardTitle>
                    <CardDescription className="text-gray-400">
                        Ingressos, PDV e consumo em parceiros — valores líquidos após comissão EventFest
                    </CardDescription>
                    <div className="w-56 mt-3">
                        <Label className="text-gray-300 text-xs">Filtrar por meio</Label>
                        <Select
                            value={fundingFilter}
                            onValueChange={(v) => setFundingFilter(v as SettlementFundingFilter)}
                        >
                            <SelectTrigger className="mt-1 bg-black border-yellow-500/30 text-white">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-black border border-yellow-500/30 text-white">
                                <SelectItem value="all" className="text-gray-200 data-[highlighted]:bg-yellow-500/15 data-[highlighted]:text-yellow-400">
                                    Todos
                                </SelectItem>
                                <SelectItem value="fast" className="text-gray-200 data-[highlighted]:bg-yellow-500/15 data-[highlighted]:text-yellow-400">
                                    PIX / débito (D+1)
                                </SelectItem>
                                <SelectItem value="card" className="text-gray-200 data-[highlighted]:bg-yellow-500/15 data-[highlighted]:text-yellow-400">
                                    Cartão (D+30 / data MP)
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                    {isError ? (
                        <Alert className="border-red-500/40 bg-red-950/40">
                            <AlertTitle className="text-red-400">Não foi possível carregar os repasses</AlertTitle>
                            <AlertDescription className="text-gray-300 text-sm space-y-3">
                                <p>{error instanceof Error ? error.message : 'Erro ao consultar o servidor.'}</p>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                                    onClick={() => void refetch()}
                                >
                                    <RefreshCw className="h-4 w-4 mr-2" />
                                    Tentar novamente
                                </Button>
                            </AlertDescription>
                        </Alert>
                    ) : isLoading ? (
                        <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto py-8" />
                    ) : items.length === 0 ? (
                        <p className="text-gray-500 text-sm text-center py-8">Nenhum repasse registrado ainda.</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow className="border-yellow-500/20">
                                    <TableHead className="text-yellow-500">Status</TableHead>
                                    <TableHead className="text-yellow-500">Data consumo</TableHead>
                                    <TableHead className="text-yellow-500">Origem</TableHead>
                                    <TableHead className="text-yellow-500">Meio</TableHead>
                                    <TableHead className="text-yellow-500 text-right">Bruto</TableHead>
                                    <TableHead className="text-yellow-500 text-right">Comissão EF</TableHead>
                                    <TableHead className="text-yellow-500 text-right">Líquido</TableHead>
                                    <TableHead className="text-yellow-500">Liberação</TableHead>
                                    <TableHead className="text-yellow-500">Ref. pagamento</TableHead>
                                    <TableHead className="text-yellow-500">Comprovante</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {items.map((row) => (
                                    <TableRow key={row.id} className="border-yellow-500/10">
                                        <TableCell className="text-gray-300 text-sm">{settlementStatusLabel(row.status)}</TableCell>
                                        <TableCell className="text-gray-400 text-xs whitespace-nowrap">{dt(row.spend_at)}</TableCell>
                                        <TableCell className="text-gray-300 text-xs max-w-[14rem]">
                                            <div className="text-yellow-500/80 text-[10px] uppercase tracking-wide mb-0.5">
                                                {settlementSourceOriginLabel(row.source_type)}
                                            </div>
                                            <div className="truncate" title={row.spend_description ?? undefined}>
                                                {row.event_title
                                                    ? `Evento: ${row.event_title}`
                                                    : row.establishment_name
                                                      ? `PDV: ${row.establishment_name}`
                                                      : row.spend_description ?? '—'}
                                            </div>
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
                                        <TableCell className="text-right text-gray-400">{money(Number(row.gross_amount ?? 0))}</TableCell>
                                        <TableCell className="text-right text-gray-500">{money(Number(row.platform_amount ?? 0))}</TableCell>
                                        <TableCell className="text-right text-yellow-400 font-medium">{money(row.manager_amount)}</TableCell>
                                        <TableCell className="text-gray-400 text-xs whitespace-nowrap">{dt(row.release_at)}</TableCell>
                                        <TableCell className="text-gray-500 text-xs font-mono truncate max-w-[8rem]" title={row.payment_reference ?? undefined}>
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
                                                    Baixar
                                                </Button>
                                            ) : (
                                                <span className="text-gray-600 text-xs">—</span>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

export default ManagerCreditSettlements;

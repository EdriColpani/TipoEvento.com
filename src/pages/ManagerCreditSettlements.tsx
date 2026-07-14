import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Banknote, Loader2, RefreshCw } from 'lucide-react';
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
import { usePageAuth } from '@/hooks/use-page-auth';
import { useManagerCreditSettlements, useManagerTicketChargebackDebts } from '@/hooks/use-credit-reports';
import { useCreditReportsAccess } from '@/hooks/use-credit-reports-access';

function money(v: number): string {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function statusLabel(s: string): string {
    const map: Record<string, string> = {
        pending: 'Retenção D+1',
        released: 'Aguardando TED/PIX EventFest',
        paid: 'Pago',
        clawback: 'Clawback',
        cancelled: 'Cancelado',
    };
    return map[s] ?? s;
}

function dt(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('pt-BR');
}

const ManagerCreditSettlements: React.FC = () => {
    const navigate = useNavigate();
    const { userId } = usePageAuth();

    const access = useCreditReportsAccess(userId);
    const { data, isLoading, isError, error, refetch } = useManagerCreditSettlements(access.company?.id);
    const debts = useManagerTicketChargebackDebts(access.company?.id);

    const summary = data?.summary;
    const retentionDays = data?.retention_days ?? 1;

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

    if (!access.canAccessManagerCreditReports) {
        return (
            <div className="max-w-3xl mx-auto text-center py-16 text-gray-400">
                Módulo de créditos não disponível para sua conta.
                <Button variant="outline" className="mt-4 block mx-auto" onClick={() => navigate('/manager/settings')}>
                    Voltar
                </Button>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto">
            <div className="flex items-center gap-4 mb-6">
                <Button variant="ghost" className="text-gray-400" onClick={() => navigate('/manager/reports/credit-spends')}>
                    <ArrowLeft className="h-4 w-4 mr-1" /> Consumos
                </Button>
                <h1 className="text-2xl font-serif text-yellow-500 flex items-center gap-2">
                    <Banknote className="h-6 w-6" />
                    Repasses pendentes — Crédito EventFest
                </h1>
            </div>

            <p className="text-gray-400 text-sm mb-4">
                Cada venda com crédito gera um repasse com retenção de {retentionDays} dia(s) (D+1). Após a liberação,
                a EventFest liquida manualmente via TED ou PIX e registra o pagamento no sistema. Seu extrato de vendas
                permanece correto independentemente do calendário de repasse — não há “erro MP” neste fluxo.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                <SummaryCard label="Em retenção D+1" value={money(Number(summary?.pending_retention ?? summary?.pending ?? 0))} />
                <SummaryCard label="Aguardando pagamento" value={money(Number(summary?.awaiting_payment ?? summary?.released ?? 0))} highlight />
                <SummaryCard label="Já recebidos" value={money(Number(summary?.paid ?? 0))} />
                <SummaryCard label="Clawback" value={money(Number(summary?.clawback ?? 0))} />
            </div>

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
                    ) : (data?.items ?? []).length === 0 ? (
                        <p className="text-gray-500 text-sm text-center py-8">Nenhum repasse registrado ainda.</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow className="border-yellow-500/20">
                                    <TableHead className="text-yellow-500">Status</TableHead>
                                    <TableHead className="text-yellow-500">Data consumo</TableHead>
                                    <TableHead className="text-yellow-500">Origem</TableHead>
                                    <TableHead className="text-yellow-500 text-right">Bruto</TableHead>
                                    <TableHead className="text-yellow-500 text-right">Comissão EF</TableHead>
                                    <TableHead className="text-yellow-500 text-right">Líquido</TableHead>
                                    <TableHead className="text-yellow-500">Liberação</TableHead>
                                    <TableHead className="text-yellow-500">Ref. pagamento</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {data!.items.map((row) => (
                                    <TableRow key={row.id} className="border-yellow-500/10">
                                        <TableCell className="text-gray-300 text-sm">{statusLabel(row.status)}</TableCell>
                                        <TableCell className="text-gray-400 text-xs whitespace-nowrap">{dt(row.spend_at)}</TableCell>
                                        <TableCell className="text-gray-300 text-xs max-w-[14rem]">
                                            <div className="truncate" title={row.spend_description ?? undefined}>
                                                {row.event_title
                                                    ? `Evento: ${row.event_title}`
                                                    : row.establishment_name
                                                      ? `PDV: ${row.establishment_name}`
                                                      : row.spend_description ?? '—'}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right text-gray-400">{money(Number(row.gross_amount ?? 0))}</TableCell>
                                        <TableCell className="text-right text-gray-500">{money(Number(row.platform_amount ?? 0))}</TableCell>
                                        <TableCell className="text-right text-yellow-400 font-medium">{money(row.manager_amount)}</TableCell>
                                        <TableCell className="text-gray-400 text-xs whitespace-nowrap">{dt(row.release_at)}</TableCell>
                                        <TableCell className="text-gray-500 text-xs font-mono truncate max-w-[8rem]" title={row.payment_reference ?? undefined}>
                                            {row.payment_reference ?? '—'}
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

function SummaryCard({
    label,
    value,
    highlight,
}: {
    label: string;
    value: string;
    highlight?: boolean;
}) {
    return (
        <Card className={`bg-black border-yellow-500/30 ${highlight ? 'border-yellow-500/60' : ''}`}>
            <CardContent className="pt-4 pb-4">
                <p className="text-gray-500 text-xs">{label}</p>
                <p className={`text-lg font-semibold mt-1 ${highlight ? 'text-yellow-500' : 'text-white'}`}>{value}</p>
            </CardContent>
        </Card>
    );
}

export default ManagerCreditSettlements;

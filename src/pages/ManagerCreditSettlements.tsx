import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Banknote, Loader2, RefreshCw } from 'lucide-react';
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
import { supabase } from '@/integrations/supabase/client';
import { useManagerCreditSettlements } from '@/hooks/use-credit-reports';
import { useCreditReportsAccess } from '@/hooks/use-credit-reports-access';
import { retryFailedCreditDisbursements } from '@/utils/credit-manager-payout';
import { showError, showSuccess } from '@/utils/toast';

function money(v: number): string {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function statusLabel(s: string): string {
    const map: Record<string, string> = {
        pending_mp: 'Aguardando MP',
        disbursed: 'Transferido (MP)',
        disbursement_failed: 'Falha MP',
        paid: 'Pago',
        clawback: 'Clawback',
        cancelled: 'Cancelado',
        pending: 'Pendente',
        released: 'Liberado',
    };
    return map[s] ?? s;
}

const ManagerCreditSettlements: React.FC = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState<string | undefined>();
    const [retrying, setRetrying] = useState(false);

    const access = useCreditReportsAccess(userId);
    const { data, isLoading, refetch } = useManagerCreditSettlements(access.company?.id);
    const failedTotal = Number(data?.summary?.failed ?? 0);
    const paidTotal = Number(data?.summary?.paid ?? 0);

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id));
    }, []);

    useEffect(() => {
        if (!access.isLoading && access.isAdminMaster) {
            navigate('/admin/settings/credit-reports', {
                state: { creditTab: 'settlements' },
                replace: true,
            });
        }
    }, [access.isLoading, access.isAdminMaster, navigate]);

    const handleRetryFailed = async () => {
        if (!access.company?.id) return;
        setRetrying(true);
        try {
            const result = await retryFailedCreditDisbursements(access.company.id);
            if (result.succeeded > 0) {
                showSuccess(`${result.succeeded} repasse(s) reprocessado(s) com sucesso.`);
            } else if (result.retried === 0) {
                showSuccess('Nenhum repasse com falha pendente.');
            } else {
                showError('Não foi possível concluir os repasses. Verifique Mercado Pago OAuth.');
            }
            refetch();
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Erro ao reprocessar repasses.');
        } finally {
            setRetrying(false);
        }
    };

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
        <div className="max-w-5xl mx-auto">
            <div className="flex items-center gap-4 mb-6">
                <Button variant="ghost" className="text-gray-400" onClick={() => navigate('/manager/reports/credit-spends')}>
                    <ArrowLeft className="h-4 w-4 mr-1" /> Consumos
                </Button>
                <h1 className="text-2xl font-serif text-yellow-500 flex items-center gap-2">
                    <Banknote className="h-6 w-6" />
                    Repasses automáticos — Crédito EventFest
                </h1>
            </div>

            <p className="text-gray-400 text-sm mb-4">
                Cada consumo via crédito dispara transferência imediata do pool EventFest para sua conta Mercado Pago
                (líquido após comissão da plataforma).
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
                <SummaryCard label="Transferidos (MP)" value={money(paidTotal)} highlight />
                <SummaryCard label="Falhas MP" value={money(failedTotal)} warn={failedTotal > 0} />
                <SummaryCard label="Clawback" value={money(Number(data?.summary?.clawback ?? 0))} />
            </div>

            {failedTotal > 0 && (
                <Button
                    variant="outline"
                    className="mb-6 border-yellow-500/40 text-yellow-500"
                    disabled={retrying}
                    onClick={handleRetryFailed}
                >
                    {retrying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                    Reprocessar repasses com falha
                </Button>
            )}

            <Card className="bg-black border-yellow-500/30">
                <CardHeader>
                    <CardTitle className="text-white">Histórico de transferências</CardTitle>
                    <CardDescription className="text-gray-400">
                        Ref. MP, comissão EventFest e valor líquido transferido
                    </CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                    {isLoading ? (
                        <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto py-8" />
                    ) : (data?.items ?? []).length === 0 ? (
                        <p className="text-gray-500 text-sm text-center py-8">Nenhuma transferência registrada ainda.</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow className="border-yellow-500/20">
                                    <TableHead className="text-yellow-500">Status</TableHead>
                                    <TableHead className="text-yellow-500 text-right">Líquido</TableHead>
                                    <TableHead className="text-yellow-500 text-right">Comissão EF</TableHead>
                                    <TableHead className="text-yellow-500">Ref. MP</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {data!.items.map((row) => (
                                    <TableRow key={row.id} className="border-yellow-500/10">
                                        <TableCell className="text-gray-300">{statusLabel(row.status)}</TableCell>
                                        <TableCell className="text-right text-yellow-400">{money(row.manager_amount)}</TableCell>
                                        <TableCell className="text-right text-gray-400">
                                            {money(Number((row as { platform_amount?: number }).platform_amount ?? 0))}
                                        </TableCell>
                                        <TableCell className="text-gray-500 text-xs font-mono truncate max-w-[10rem]" title={row.mp_payout_reference ?? undefined}>
                                            {row.mp_payout_reference ?? '—'}
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
    warn,
}: {
    label: string;
    value: string;
    highlight?: boolean;
    warn?: boolean;
}) {
    return (
        <Card className={`bg-black border-yellow-500/30 ${highlight ? 'border-yellow-500/60' : ''}`}>
            <CardContent className="pt-4 pb-4">
                <p className="text-gray-500 text-xs">{label}</p>
                <p
                    className={`text-lg font-semibold mt-1 ${
                        warn ? 'text-red-400' : highlight ? 'text-yellow-500' : 'text-white'
                    }`}
                >
                    {value}
                </p>
            </CardContent>
        </Card>
    );
}

export default ManagerCreditSettlements;

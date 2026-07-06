import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Banknote, Loader2, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { usePageAuth } from '@/hooks/use-page-auth';
import { useManagerCreditSpends } from '@/hooks/use-credit-reports';
import { useCreditReportsAccess } from '@/hooks/use-credit-reports-access';

function money(v: number | null | undefined): string {
    return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const ManagerCreditSpendsReport: React.FC = () => {
    const navigate = useNavigate();
    const { userId } = usePageAuth();

    const access = useCreditReportsAccess(userId);
    const { data: items, isLoading, isError } = useManagerCreditSpends(access.company?.id);

    useEffect(() => {
        if (!access.isLoading && access.isAdminMaster) {
            navigate('/admin/settings/credit-reports', {
                state: { creditTab: 'commission' },
                replace: true,
            });
        }
    }, [access.isLoading, access.isAdminMaster, navigate]);

    const totals = (items ?? []).reduce(
        (acc, row) => {
            acc.gross += Number(row.gross_amount ?? 0);
            acc.platform += Number(row.platform_amount ?? 0);
            acc.manager += Number(row.manager_amount ?? 0);
            return acc;
        },
        { gross: 0, platform: 0, manager: 0 },
    );

    if (access.isLoading || access.isAdminMaster) {
        return (
            <div className="max-w-3xl mx-auto text-center py-16 text-gray-400">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-3" />
                Redirecionando para o painel Admin...
            </div>
        );
    }

    if (!access.canAccessManagerCreditReports && !access.canAccessAdminCreditReports) {
        return (
            <div className="max-w-4xl mx-auto text-center py-16 text-gray-400">
                Módulo de créditos não disponível para sua conta.
                <Button variant="outline" className="mt-4 block mx-auto" onClick={() => navigate('/manager/reports')}>
                    Voltar
                </Button>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" className="text-gray-400" onClick={() => navigate('/manager/reports')}>
                        <ArrowLeft className="h-4 w-4 mr-1" /> Relatórios
                    </Button>
                    <h1 className="text-2xl font-serif text-yellow-500 flex items-center gap-2">
                        <Wallet className="h-6 w-6" />
                        Consumos via crédito EventFest
                    </h1>
                </div>
                <Button
                    variant="outline"
                    className="border-yellow-500/40 text-yellow-500"
                    onClick={() => navigate('/manager/credit/settlements')}
                >
                    <Banknote className="h-4 w-4 mr-2" /> Repasses
                </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <StatCard label="Total recebido (gross)" value={money(totals.gross)} />
                <StatCard label="Comissão EventFest" value={money(totals.platform)} />
                <StatCard label="Líquido empresa" value={money(totals.manager)} />
            </div>

            <Card className="bg-black border-yellow-500/30">
                <CardHeader>
                    <CardTitle className="text-white text-lg">Movimentações</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                    {isLoading ? (
                        <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto py-8" />
                    ) : isError ? (
                        <p className="text-red-400 text-sm text-center py-8">Erro ao carregar relatório.</p>
                    ) : (items ?? []).length === 0 ? (
                        <p className="text-gray-500 text-sm text-center py-8">Nenhum consumo via crédito registrado.</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow className="border-yellow-500/20">
                                    <TableHead className="text-yellow-500">Data</TableHead>
                                    <TableHead className="text-yellow-500">Evento</TableHead>
                                    <TableHead className="text-yellow-500 text-right">Gross</TableHead>
                                    <TableHead className="text-yellow-500 text-right">Líquido</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {items!.map((row) => (
                                    <TableRow key={row.spend_order_id} className="border-yellow-500/10">
                                        <TableCell className="text-gray-400 text-xs whitespace-nowrap">
                                            {new Date(row.created_at).toLocaleString('pt-BR')}
                                        </TableCell>
                                        <TableCell className="text-gray-200 text-sm max-w-xs truncate" title={row.public_description ?? ''}>
                                            {row.event_title ?? row.public_description ?? '—'}
                                        </TableCell>
                                        <TableCell className="text-right text-gray-300">{money(row.gross_amount)}</TableCell>
                                        <TableCell className="text-right text-yellow-400">{money(row.manager_amount)}</TableCell>
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

function StatCard({ label, value }: { label: string; value: string }) {
    return (
        <Card className="bg-black border-yellow-500/30">
            <CardContent className="pt-6">
                <p className="text-gray-500 text-xs">{label}</p>
                <p className="text-xl font-semibold text-yellow-500 mt-1">{value}</p>
            </CardContent>
        </Card>
    );
}

export default ManagerCreditSpendsReport;

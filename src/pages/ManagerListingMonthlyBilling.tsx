import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ArrowLeft, CalendarDays, Loader2, Receipt } from 'lucide-react';
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
import { useProfile } from '@/hooks/use-profile';
import { useManagerCompany } from '@/hooks/use-manager-company';
import { useCompanyBilling } from '@/hooks/use-company-billing';
import { useListingMonthlyCharges, ListingChargeStatus } from '@/hooks/use-listing-monthly-charges';
import { isListingMonthlyPlan } from '@/utils/company-billing-rules';
import { supabase } from '@/integrations/supabase/client';

const STATUS_LABELS: Record<ListingChargeStatus, string> = {
    pending: 'Pendente',
    paid: 'Pago',
    cancelled: 'Cancelado',
};

function formatMoney(value: number): string {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatReferenceMonth(isoDate: string): string {
    try {
        return format(parseISO(isoDate), "MMMM 'de' yyyy", { locale: ptBR });
    } catch {
        return isoDate;
    }
}

const ManagerListingMonthlyBilling: React.FC = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState<string | undefined>();

    React.useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id));
    }, []);

    const { profile, isLoading: loadingProfile } = useProfile(userId);
    const { company, isLoading: loadingCompany } = useManagerCompany(userId);
    const { billing, isLoading: loadingBilling } = useCompanyBilling(company?.id);
    const isListingPlan = isListingMonthlyPlan(billing?.billing_plan);

    const { charges, isLoading, isError } = useListingMonthlyCharges(
        !!company?.id && isListingPlan,
        company?.id,
    );

    const summary = useMemo(() => {
        const pending = charges.filter((c) => c.status === 'pending');
        return {
            pendingCount: pending.length,
            pendingAmount: pending.reduce((s, c) => s + c.amount, 0),
        };
    }, [charges]);

    if (loadingProfile || loadingCompany || !userId) {
        return (
            <div className="max-w-5xl mx-auto text-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando...</p>
            </div>
        );
    }

    if (!isListingPlan) {
        return (
            <div className="max-w-5xl mx-auto">
                <Button
                    variant="outline"
                    onClick={() => navigate('/manager/reports')}
                    className="mb-6 border-yellow-500/30 text-yellow-500"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                </Button>
                <Card className="bg-black border-yellow-500/30 p-8 text-center">
                    <p className="text-gray-300">
                        Este relatório é exclusivo para empresas no plano{' '}
                        <strong className="text-yellow-500">mensalidade — divulgação</strong>.
                    </p>
                    <p className="text-gray-500 text-sm mt-2">
                        Plano atual: {billing?.billing_plan ?? 'não definido'}
                    </p>
                </Card>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto">
            <div className="flex items-center justify-between mb-8 gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center gap-3">
                        <Receipt className="h-7 w-7" />
                        Mensalidade de divulgação
                    </h1>
                    <p className="text-gray-400 text-sm mt-2">
                        Faturas mensais do plano vitrine — {company?.trade_name || company?.corporate_name}
                    </p>
                </div>
                <Button
                    variant="outline"
                    onClick={() => navigate('/manager/reports')}
                    className="border-yellow-500/30 text-yellow-500"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                </Button>
            </div>

            <Card className="bg-black border-yellow-500/30 mb-6">
                <CardHeader className="pb-2">
                    <CardDescription className="text-gray-400">Em aberto</CardDescription>
                    <CardTitle className="text-amber-400 text-xl">
                        {summary.pendingCount} fatura(s) · {formatMoney(summary.pendingAmount)}
                    </CardTitle>
                </CardHeader>
                <CardContent className="text-gray-500 text-xs">
                    Pagamentos são confirmados pelo administrador da plataforma.
                </CardContent>
            </Card>

            <Card className="bg-black border border-yellow-500/30 rounded-2xl">
                <CardHeader>
                    <CardTitle className="text-white flex items-center gap-2">
                        <CalendarDays className="h-5 w-5 text-yellow-500" />
                        Histórico de cobranças
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {loadingBilling || isLoading ? (
                        <div className="text-center py-12">
                            <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto" />
                        </div>
                    ) : isError ? (
                        <p className="text-red-400 text-center py-8">Erro ao carregar cobranças.</p>
                    ) : charges.length === 0 ? (
                        <p className="text-gray-400 text-center py-8">
                            Nenhuma cobrança registrada ainda para sua empresa.
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-yellow-500/20">
                                        <TableHead className="text-yellow-500">Mês</TableHead>
                                        <TableHead className="text-yellow-500">Valor</TableHead>
                                        <TableHead className="text-yellow-500">Status</TableHead>
                                        <TableHead className="text-yellow-500">Pago em</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {charges.map((charge) => (
                                        <TableRow key={charge.id} className="border-yellow-500/10">
                                            <TableCell className="text-white capitalize">
                                                {formatReferenceMonth(charge.reference_month)}
                                            </TableCell>
                                            <TableCell className="text-white">
                                                {formatMoney(charge.amount)}
                                            </TableCell>
                                            <TableCell
                                                className={
                                                    charge.status === 'paid'
                                                        ? 'text-green-400'
                                                        : charge.status === 'cancelled'
                                                          ? 'text-gray-500'
                                                          : 'text-amber-400'
                                                }
                                            >
                                                {STATUS_LABELS[charge.status]}
                                            </TableCell>
                                            <TableCell className="text-gray-400 text-sm">
                                                {charge.paid_at
                                                    ? format(parseISO(charge.paid_at), 'dd/MM/yyyy', {
                                                          locale: ptBR,
                                                      })
                                                    : '—'}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

export default ManagerListingMonthlyBilling;

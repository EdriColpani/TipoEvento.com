import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Copy, Loader2, RefreshCw } from 'lucide-react';
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
import { useProfile } from '@/hooks/use-profile';
import { useManagerCompany } from '@/hooks/use-manager-company';
import { useCompanyBilling } from '@/hooks/use-company-billing';
import { useManagerTicketChargebackDebts } from '@/hooks/use-credit-reports';
import { companyAllowsTicketSales } from '@/utils/company-billing-rules';
import { isCompanyBillingReady } from '@/constants/billing-plans';
import { callRpcRest } from '@/utils/supabase-rest-rpc';
import { showError, showSuccess } from '@/utils/toast';
import TicketChargebackBlockBanner from '@/components/TicketChargebackBlockBanner';
import { useCompanyTicketChargebackBlock } from '@/hooks/use-company-ticket-chargeback-block';

function money(v: number): string {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dt(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('pt-BR');
}

type PaymentInstructions = {
    pix_key?: string | null;
    pix_holder?: string | null;
    instructions?: string | null;
};

const ManagerTicketChargebacks: React.FC = () => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { userId } = usePageAuth();
    const { profile, isLoading: profileLoading } = useProfile(userId);
    const isAdminMaster = profile?.tipo_usuario_id === 1;
    const isManagerPro = profile?.tipo_usuario_id === 2;

    const { company, isLoading: companyLoading } = useManagerCompany(
        isManagerPro && !isAdminMaster ? userId : undefined,
    );
    const { billing, isLoading: billingLoading } = useCompanyBilling(company?.id);

    const canAccess =
        isManagerPro &&
        !isAdminMaster &&
        Boolean(company?.id) &&
        isCompanyBillingReady(billing) &&
        companyAllowsTicketSales(billing?.billing_plan);

    const debts = useManagerTicketChargebackDebts(company?.id);
    const blockStatus = useCompanyTicketChargebackBlock(company?.id, canAccess);

    const instructions = useQuery({
        queryKey: ['ticketChargebackPaymentInstructions'],
        queryFn: () => callRpcRest<PaymentInstructions>('get_ticket_chargeback_payment_instructions', {}, 15_000),
        staleTime: 60_000,
        enabled: Boolean(company?.id),
    });

    const openManual = useMemo(
        () =>
            (debts.data ?? []).filter(
                (d) =>
                    (d.status === 'open' || d.status === 'partial') &&
                    (d.recovery_mode === 'manual_pix' || !d.recovery_mode),
            ),
        [debts.data],
    );

    const openOffset = useMemo(
        () =>
            (debts.data ?? []).filter(
                (d) =>
                    (d.status === 'open' || d.status === 'partial') &&
                    d.recovery_mode === 'credit_settlement_offset',
            ),
        [debts.data],
    );

    const [copied, setCopied] = useState<string | null>(null);

    const copyText = async (label: string, value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(label);
            showSuccess('Copiado.');
            setTimeout(() => setCopied(null), 1500);
        } catch {
            showError('Não foi possível copiar.');
        }
    };

    if (profileLoading || companyLoading || billingLoading || isAdminMaster) {
        return (
            <div className="max-w-3xl mx-auto text-center py-16 text-gray-400">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-3" />
                {isAdminMaster ? 'Redirecione pelo painel Admin → Chargebacks.' : 'Carregando…'}
            </div>
        );
    }

    if (!canAccess) {
        return (
            <div className="max-w-3xl mx-auto text-center py-16 text-gray-400">
                Chargebacks de ingresso não disponíveis para sua conta.
                <Button
                    variant="outline"
                    className="mt-4 block mx-auto bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                    onClick={() => navigate('/manager/reports')}
                >
                    Voltar
                </Button>
            </div>
        );
    }

    const pixKey = instructions.data?.pix_key?.trim() || '';
    const pixHolder = instructions.data?.pix_holder?.trim() || '';
    const extraInstructions = instructions.data?.instructions?.trim() || '';

    return (
        <div className="max-w-6xl mx-auto">
            <div className="flex items-center gap-4 mb-6">
                <Button variant="ghost" className="text-gray-400" onClick={() => navigate('/manager/reports')}>
                    <ArrowLeft className="h-4 w-4 mr-1" /> Relatórios
                </Button>
                <h1 className="text-2xl font-serif text-yellow-500 flex items-center gap-2">
                    <AlertTriangle className="h-6 w-6" />
                    Chargebacks de ingresso
                </h1>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="ml-auto bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                    onClick={() => {
                        void debts.refetch();
                        void blockStatus.refetch();
                        void queryClient.invalidateQueries({ queryKey: ['ticketChargebackPaymentInstructions'] });
                        void queryClient.invalidateQueries({ queryKey: ['companyTicketChargebackBlock'] });
                    }}
                >
                    <RefreshCw className="h-4 w-4 mr-1" /> Atualizar
                </Button>
            </div>

            <TicketChargebackBlockBanner
                status={blockStatus.data}
                isLoading={blockStatus.isLoading}
            />

            {openManual.length > 0 && (
                <Alert className="mb-6 border-amber-500/40 bg-amber-950/50 text-amber-50">
                    <AlertTriangle className="h-4 w-4 text-amber-300" />
                    <AlertTitle className="text-amber-200">Devolução via PIX/TED obrigatória</AlertTitle>
                    <AlertDescription className="text-amber-50/90 text-sm space-y-2">
                        <p>
                            Sua empresa opera com venda de ingressos sem repasse automático de crédito. Quando há
                            chargeback, o valor líquido deve ser <strong>devolvido à EventFest</strong> via PIX ou TED.
                        </p>
                        <p>
                            Total em aberto:{' '}
                            <strong>
                                {money(openManual.reduce((s, d) => s + Number(d.amount_remaining ?? 0), 0))}
                            </strong>
                        </p>
                    </AlertDescription>
                </Alert>
            )}

            {openManual.length > 0 && (
                <Card className="bg-black border-yellow-500/30 mb-6">
                    <CardHeader>
                        <CardTitle className="text-white">Dados para pagamento</CardTitle>
                        <CardDescription className="text-gray-400">
                            Use a referência de cada dívida no comprovante. Após o PIX, o Admin Master confirma a baixa.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm text-gray-300">
                        {pixHolder ? (
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-gray-500 w-28">Recebedor</span>
                                <span>{pixHolder}</span>
                            </div>
                        ) : null}
                        {pixKey ? (
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-gray-500 w-28">Chave PIX</span>
                                <code className="text-yellow-400 text-xs break-all">{pixKey}</code>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                                    onClick={() => void copyText('pix', pixKey)}
                                >
                                    <Copy className="h-3 w-3 mr-1" /> {copied === 'pix' ? 'Copiado' : 'Copiar'}
                                </Button>
                            </div>
                        ) : (
                            <p className="text-amber-200/90">
                                Chave PIX ainda não configurada pelo Admin. Entre em contato com o suporte EventFest
                                e informe a referência da dívida ao enviar o comprovante.
                            </p>
                        )}
                        {extraInstructions ? (
                            <p className="text-gray-400 whitespace-pre-wrap border-t border-yellow-500/10 pt-3">
                                {extraInstructions}
                            </p>
                        ) : null}
                    </CardContent>
                </Card>
            )}

            {openOffset.length > 0 && (
                <Alert className="mb-6 border-cyan-500/30 bg-cyan-950/40 text-cyan-50">
                    <AlertTitle className="text-cyan-100">Abatimento no repasse de crédito</AlertTitle>
                    <AlertDescription className="text-cyan-50/90 text-sm">
                        {openOffset.length} dívida(s) serão descontadas automaticamente na próxima liquidação D+1 de
                        crédito (total{' '}
                        {money(openOffset.reduce((s, d) => s + Number(d.amount_remaining ?? 0), 0))}).
                    </AlertDescription>
                </Alert>
            )}

            <Card className="bg-black border-yellow-500/30">
                <CardHeader>
                    <CardTitle className="text-white">Histórico de dívidas</CardTitle>
                    <CardDescription className="text-gray-400">
                        Chargebacks Mercado Pago em vendas de ingresso desta empresa.
                    </CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                    {debts.isLoading ? (
                        <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto py-8" />
                    ) : (debts.data ?? []).length === 0 ? (
                        <p className="text-gray-500 text-sm text-center py-8">Nenhum chargeback de ingresso.</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow className="border-yellow-500/20">
                                    <TableHead className="text-yellow-500">Data</TableHead>
                                    <TableHead className="text-yellow-500">Evento</TableHead>
                                    <TableHead className="text-yellow-500">Cobrança</TableHead>
                                    <TableHead className="text-yellow-500">Ref. pagamento</TableHead>
                                    <TableHead className="text-yellow-500">Status</TableHead>
                                    <TableHead className="text-yellow-500 text-right">Restante</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {debts.data!.map((row) => (
                                    <TableRow key={row.id} className="border-yellow-500/10">
                                        <TableCell className="text-gray-400 text-xs whitespace-nowrap">
                                            {dt(row.created_at)}
                                        </TableCell>
                                        <TableCell className="text-gray-300 text-xs max-w-[12rem] truncate">
                                            {row.event_title ?? '—'}
                                        </TableCell>
                                        <TableCell className="text-gray-300 text-xs">
                                            {row.recovery_mode === 'credit_settlement_offset'
                                                ? 'Desconto no repasse'
                                                : 'PIX/TED para EventFest'}
                                        </TableCell>
                                        <TableCell className="text-yellow-400 text-xs font-mono">
                                            <button
                                                type="button"
                                                className="hover:underline"
                                                title="Copiar referência"
                                                onClick={() =>
                                                    void copyText(row.id, row.payment_ref_hint || row.id)
                                                }
                                            >
                                                {row.payment_ref_hint ?? '—'}
                                            </button>
                                        </TableCell>
                                        <TableCell className="text-gray-300 text-sm">{row.status}</TableCell>
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
        </div>
    );
};

export default ManagerTicketChargebacks;

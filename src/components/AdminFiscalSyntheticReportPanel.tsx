import React, { useMemo, useState } from 'react';
import { Download, Loader2, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAdminFiscalSyntheticReport } from '@/hooks/use-credit-reports';
import { exportFiscalSyntheticCsv } from '@/utils/export-fiscal-synthetic-csv';
import { showError, showSuccess } from '@/utils/toast';

function money(v: number | null | undefined): string {
    return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function monthStartIso(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function todayIso(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const BTN_OUTLINE =
    'bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400 disabled:opacity-50';

function Row({
    label,
    value,
    hint,
}: {
    label: string;
    value: string;
    hint?: string;
}) {
    return (
        <div className="flex items-start justify-between gap-4 py-2 border-b border-yellow-500/10 last:border-0">
            <div>
                <p className="text-sm text-gray-200">{label}</p>
                {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
            </div>
            <p className="text-sm text-white whitespace-nowrap">{value}</p>
        </div>
    );
}

function GroupBox({
    title,
    children,
}: {
    title: string;
    children: React.ReactNode;
}) {
    return (
        <div className="rounded-lg border border-yellow-500/20 bg-black/40 p-3 space-y-1">
            <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">{title}</p>
            {children}
        </div>
    );
}

function SubtotalBar({ label, formula, value }: { label: string; formula: string; value: string }) {
    return (
        <div className="mt-2 flex items-start justify-between gap-4 rounded-md bg-yellow-500/10 border border-yellow-500/30 px-3 py-2">
            <div>
                <p className="text-sm font-semibold text-yellow-400">{label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{formula}</p>
            </div>
            <p className="text-sm font-bold text-yellow-400 whitespace-nowrap">{value}</p>
        </div>
    );
}

function GrandTotalBar({ label, formula, value }: { label: string; formula: string; value: string }) {
    return (
        <div className="flex items-start justify-between gap-4 rounded-lg bg-cyan-950/50 border border-cyan-500/40 px-4 py-3">
            <div>
                <p className="text-base font-semibold text-cyan-100">{label}</p>
                <p className="text-xs text-cyan-200/70 mt-0.5">{formula}</p>
            </div>
            <p className="text-xl font-bold text-white whitespace-nowrap">{value}</p>
        </div>
    );
}

const AdminFiscalSyntheticReportPanel: React.FC = () => {
    const [startDate, setStartDate] = useState(monthStartIso);
    const [endDate, setEndDate] = useState(todayIso);
    const query = useAdminFiscalSyntheticReport(startDate || null, endDate || null);
    const data = query.data;

    const periodLabel = useMemo(() => {
        const fmt = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR');
        return `${fmt(startDate)} a ${fmt(endDate)}`;
    }, [startDate, endDate]);

    const handleCsv = () => {
        if (!data) {
            showError('Aguarde o relatório carregar.');
            return;
        }
        exportFiscalSyntheticCsv(data, startDate, endDate);
        showSuccess('CSV do sintético fiscal exportado.');
    };

    return (
        <div id="fiscal-synthetic-print" className="space-y-4">
            <style>{`@media print { body * { visibility: hidden; } #fiscal-synthetic-print, #fiscal-synthetic-print * { visibility: visible; } #fiscal-synthetic-print { position: absolute; left: 0; top: 0; width: 100%; } .fiscal-no-print { display: none !important; } }`}</style>

            <Card className="bg-black border-yellow-500/30">
                <CardHeader>
                    <CardTitle className="text-white text-lg">Sintético fiscal — EventFest</CardTitle>
                    <CardDescription className="text-gray-400">
                        Período {periodLabel}. O giro na conta Mercado Pago não é faturamento. O lucro da EventFest é a
                        soma das comissões, mensalidades, licença e taxa de inatividade.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-4 items-end fiscal-no-print">
                    <div>
                        <Label className="text-gray-400 text-xs">Início</Label>
                        <Input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="bg-black border-yellow-500/30 text-white mt-1"
                        />
                    </div>
                    <div>
                        <Label className="text-gray-400 text-xs">Fim</Label>
                        <Input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="bg-black border-yellow-500/30 text-white mt-1"
                        />
                    </div>
                    <Button type="button" className="bg-yellow-500 text-black hover:bg-yellow-600" onClick={handleCsv}>
                        <Download className="h-4 w-4 mr-1" /> CSV
                    </Button>
                    <Button type="button" variant="outline" className={BTN_OUTLINE} onClick={() => window.print()}>
                        <Printer className="h-4 w-4 mr-1" /> Imprimir / PDF
                    </Button>
                </CardContent>
            </Card>

            {query.isLoading ? (
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto" />
            ) : query.isError ? (
                <p className="text-red-400 text-sm text-center">Não foi possível carregar o sintético fiscal.</p>
            ) : (
                <>
                    <Card className="bg-black border-yellow-500/30">
                        <CardHeader>
                            <CardTitle className="text-yellow-500 text-base">1. Créditos dos clientes</CardTitle>
                            <CardDescription className="text-gray-400">
                                Dinheiro do cliente na carteira EventFest. É obrigação de devolver em ingresso ou consumo
                                — não é receita da plataforma.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <GroupBox title="Recargas no período">
                                <Row
                                    label="Bruto pago pelo cliente"
                                    value={money(data?.client_credits?.topup_gross)}
                                    hint="O que entrou na conta EventFest via Mercado Pago."
                                />
                                <Row
                                    label="Crédito creditado nas carteiras"
                                    value={money(data?.client_credits?.topup_credit_granted)}
                                />
                            </GroupBox>
                            <GroupBox title="Uso da carteira no período">
                                <Row
                                    label="Ingresso"
                                    value={money(data?.client_credits?.spend_ticket_gross)}
                                />
                                <Row
                                    label="Consumo"
                                    value={money(data?.client_credits?.spend_consumption_gross)}
                                />
                                <SubtotalBar
                                    label="Subtotal consumido"
                                    formula={`${money(data?.client_credits?.spend_ticket_gross)} + ${money(data?.client_credits?.spend_consumption_gross)} — já somado, não some de novo.`}
                                    value={money(data?.client_credits?.spend_gross)}
                                />
                                <Row label="Estornos no período" value={money(data?.client_credits?.refunds_period)} />
                            </GroupBox>
                            <GroupBox title="Posição agora">
                                <Row
                                    label="Saldo em carteira"
                                    value={money(data?.client_credits?.wallet_balance_now)}
                                    hint="Estoque atual: ainda não consumido. Não some com os quadros acima."
                                />
                            </GroupBox>
                        </CardContent>
                    </Card>

                    <Card className="bg-black border-yellow-500/30">
                        <CardHeader>
                            <CardTitle className="text-yellow-500 text-base">2. Despesa taxas Mercado Pago</CardTitle>
                            <CardDescription className="text-gray-400">
                                Só o que a EventFest paga de taxa. Split automático na conta do gestor aparece à parte.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <GroupBox title="Despesa na conta EventFest">
                                <Row label="Recargas" value={money(data?.mp_fees?.topup)} />
                                <Row label="Ingressos na conta EventFest (D+1)" value={money(data?.mp_fees?.ticket_d1)} />
                                <Row label="Mensalidade vitrine" value={money(data?.mp_fees?.listing_monthly)} />
                                <Row label="Licença de consumo" value={money(data?.mp_fees?.consumption_license)} />
                                <SubtotalBar
                                    label="Total despesa MP EventFest"
                                    formula="Soma só das 4 linhas deste quadro — não some de novo abaixo."
                                    value={money(data?.mp_fees?.eventfest_total)}
                                />
                            </GroupBox>
                            <div className="rounded-lg border border-gray-700/80 px-3 py-2">
                                <Row
                                    label="Taxa MP no split do gestor (fora do total)"
                                    value={money(data?.mp_fees?.ticket_mp_split_manager)}
                                    hint="Não entra na despesa EventFest: o ingresso foi cobrado na conta do gestor."
                                />
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-black border-yellow-500/30">
                        <CardHeader>
                            <CardTitle className="text-yellow-500 text-base">3. Lucro EventFest</CardTitle>
                            <CardDescription className="text-gray-400">
                                Três quadros (A ingresso, B consumo, C cobranças). Os subtotais já somam o quadro; o
                                lucro final é A + B + C. Taxa MP não é abatida.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <GroupBox title="A. Comissão de ingresso">
                                <Row
                                    label="Via Mercado Pago (split)"
                                    value={money(data?.profit?.ticket_mp_split?.commission)}
                                    hint={`Bruto ${money(data?.profit?.ticket_mp_split?.gross)} · líquido gestor ${money(data?.profit?.ticket_mp_split?.manager_net)}`}
                                />
                                <Row
                                    label="Via Mercado Pago (caixa EventFest D+1)"
                                    value={money(data?.profit?.ticket_mp_d1?.commission)}
                                    hint={`Bruto ${money(data?.profit?.ticket_mp_d1?.gross)} · líquido gestor ${money(data?.profit?.ticket_mp_d1?.manager_net)}`}
                                />
                                <Row
                                    label="Via carteira EventFest"
                                    value={money(data?.profit?.ticket_wallet?.commission)}
                                    hint={`Bruto ${money(data?.profit?.ticket_wallet?.gross)} · líquido gestor ${money(data?.profit?.ticket_wallet?.manager_net)}`}
                                />
                                <SubtotalBar
                                    label="Subtotal ingresso"
                                    formula={`${money(data?.profit?.ticket_mp_split?.commission)} + ${money(data?.profit?.ticket_mp_d1?.commission)} + ${money(data?.profit?.ticket_wallet?.commission)} — já somado, não some de novo.`}
                                    value={money(data?.profit?.ticket_commission_total)}
                                />
                            </GroupBox>

                            <GroupBox title="B. Comissão de consumo">
                                <Row
                                    label="Via carteira EventFest"
                                    value={money(data?.profit?.consumption_wallet?.commission)}
                                    hint={`Bruto ${money(data?.profit?.consumption_wallet?.gross)} · líquido gestor ${money(data?.profit?.consumption_wallet?.manager_net)}`}
                                />
                                <SubtotalBar
                                    label="Subtotal consumo"
                                    formula={`${money(data?.profit?.consumption_wallet?.commission)} — já somado, não some de novo.`}
                                    value={money(data?.profit?.consumption_wallet?.commission)}
                                />
                            </GroupBox>

                            <GroupBox title="C. Cobranças de plano">
                                <Row label="Mensalidade vitrine" value={money(data?.profit?.listing_monthly)} />
                                <Row label="Licença de consumo" value={money(data?.profit?.consumption_license)} />
                                <Row label="Taxa de inatividade de ingressos" value={money(data?.profit?.ticket_inactivity)} />
                                <SubtotalBar
                                    label="Subtotal cobranças"
                                    formula={`${money(data?.profit?.listing_monthly)} + ${money(data?.profit?.consumption_license)} + ${money(data?.profit?.ticket_inactivity)} — já somado, não some de novo.`}
                                    value={money(data?.profit?.other_billing_total)}
                                />
                            </GroupBox>

                            <GrandTotalBar
                                label="Lucro EventFest (base de imposto)"
                                formula={`A ${money(data?.profit?.ticket_commission_total)} + B ${money(data?.profit?.consumption_wallet?.commission)} + C ${money(data?.profit?.other_billing_total)}`}
                                value={money(data?.profit?.eventfest_profit_total)}
                            />
                        </CardContent>
                    </Card>

                    <Card className="bg-black border-cyan-500/40">
                        <CardHeader>
                            <CardTitle className="text-cyan-200 text-base">4. Giro na conta × lucro</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-gray-200 space-y-3 leading-relaxed">
                            <p>
                                No período entrou na conta EventFest (recargas + ingressos D+1 + cobranças de plano){' '}
                                <strong className="text-white">{money(data?.bridge?.cash_through_eventfest)}</strong>.
                                Desse giro, a maior parte é obrigação: crédito em carteira ou repasse ao gestor.
                            </p>
                            <p>
                                A receita da EventFest neste período é{' '}
                                <strong className="text-yellow-400">{money(data?.bridge?.eventfest_profit)}</strong>{' '}
                                (comissões + mensalidades + licença + inatividade). A despesa de taxa Mercado Pago da
                                EventFest é <strong className="text-white">{money(data?.bridge?.mp_expense_eventfest)}</strong>.
                            </p>
                            <p>
                                Ainda há <strong className="text-white">{money(data?.bridge?.wallet_obligation_now)}</strong>{' '}
                                em carteiras de clientes e{' '}
                                <strong className="text-white">{money(data?.bridge?.pending_remit_now)}</strong> a
                                repassar aos gestores. No período já foram pagos{' '}
                                <strong className="text-white">{money(data?.bridge?.remitted_to_managers_period)}</strong>.
                            </p>
                            <p className="text-cyan-100/90 text-xs">
                                O valor alto na conta não é lucro. O lucro (base) é o total do bloco 3.
                            </p>
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    );
};

export default AdminFiscalSyntheticReportPanel;

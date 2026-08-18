import type { AdminFiscalSyntheticReport } from '@/hooks/use-credit-reports';

function moneyCsv(value: number | null | undefined): string {
    return String(Number(value ?? 0)).replace('.', ',');
}

function line(label: string, value: number | null | undefined): string {
    return `${label};${moneyCsv(value)}`;
}

export function exportFiscalSyntheticCsv(
    report: AdminFiscalSyntheticReport,
    startDate: string,
    endDate: string,
): void {
    const c = report.client_credits;
    const f = report.mp_fees;
    const p = report.profit;
    const b = report.bridge;
    const rows = [
        'Sintético fiscal EventFest (Admin Master)',
        `Período;${startDate || 'início'} a ${endDate || 'hoje'}`,
        '',
        '1. Créditos dos clientes (passivo — não é receita EventFest)',
        line('Recargas no período (bruto pago pelo cliente)', c?.topup_gross),
        line('Crédito creditado nas carteiras', c?.topup_credit_granted),
        line('Saldo em carteira agora (obrigação)', c?.wallet_balance_now),
        line('Consumido no período (ingresso + consumo)', c?.spend_gross),
        line('Estornos de crédito no período', c?.refunds_period),
        '',
        '2. Despesa taxas Mercado Pago (conta EventFest)',
        line('Taxa MP nas recargas', f?.topup),
        line('Taxa MP nos ingressos D+1 (caixa EventFest)', f?.ticket_d1),
        line('Taxa MP na mensalidade vitrine', f?.listing_monthly),
        line('Taxa MP na licença de consumo', f?.consumption_license),
        line('Total despesa MP EventFest', f?.eventfest_total),
        line('Taxa MP no split automático (conta do gestor — não é despesa EventFest)', f?.ticket_mp_split_manager),
        '',
        '3. Lucro EventFest (comissões + mensalidades + licença + inatividade)',
        line('Ingresso Mercado Pago split — comissão', p?.ticket_mp_split?.commission),
        line('Ingresso Mercado Pago D+1 — comissão', p?.ticket_mp_d1?.commission),
        line('Ingresso carteira EventFest — comissão', p?.ticket_wallet?.commission),
        line('Total lucro ingresso', p?.ticket_commission_total),
        line('Consumo carteira EventFest — comissão', p?.consumption_wallet?.commission),
        line('Mensalidade vitrine', p?.listing_monthly),
        line('Licença de consumo', p?.consumption_license),
        line('Taxa de inatividade de ingressos', p?.ticket_inactivity),
        line('Total lucro EventFest', p?.eventfest_profit_total),
        '',
        '4. Ponte giro x lucro',
        line('Giro na conta EventFest (recargas + ingresso D+1 + cobranças)', b?.cash_through_eventfest),
        line('Lucro EventFest (base)', b?.eventfest_profit),
        line('Despesa MP EventFest', b?.mp_expense_eventfest),
        line('Obrigação em carteira agora', b?.wallet_obligation_now),
        line('Repassado aos gestores no período', b?.remitted_to_managers_period),
        line('A repassar agora (D+1 / PIX)', b?.pending_remit_now),
    ];

    const blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sintetico-fiscal-eventfest-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

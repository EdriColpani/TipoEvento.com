import type { AdminCreditTopupChargebackRow } from '@/hooks/use-credit-reports';

function escapeCsv(value: string): string {
    if (/[",\n\r]/.test(value)) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

function moneyCsv(value: number | null | undefined): string {
    if (value == null || Number.isNaN(Number(value))) return '';
    return String(Number(value)).replace('.', ',');
}

const CSV_HEADER = [
    'Data/Hora',
    'Status MP',
    'ID cliente',
    'Crédito concedido',
    'Débito carteira',
    'Clawback gestores',
    'Absorção EventFest',
    'Settlements clawback',
    'Pagamento MP',
    'Pedido recarga',
    'Valor pago bruto',
    'Empresa origem',
    'Recarga paga em',
    'Motivo',
    'Alerta e-mail enviado',
].join(';');

function rowToCsvLine(row: AdminCreditTopupChargebackRow & { admin_notified_at?: string | null }): string {
    return [
        new Date(row.created_at).toLocaleString('pt-BR'),
        escapeCsv(row.mp_status ?? ''),
        row.client_user_id ?? '',
        moneyCsv(row.credit_granted_amount),
        moneyCsv(row.wallet_debit),
        moneyCsv(row.clawback_manager_total),
        moneyCsv(row.platform_absorb),
        String(row.clawback_settlement_count ?? ''),
        escapeCsv(row.mp_payment_id ?? ''),
        row.topup_order_id ?? '',
        moneyCsv(row.gross_paid_amount),
        escapeCsv(row.origin_company_name ?? ''),
        row.topup_paid_at ? new Date(row.topup_paid_at).toLocaleString('pt-BR') : '',
        escapeCsv(row.reason ?? ''),
        row.admin_notified_at ? new Date(row.admin_notified_at).toLocaleString('pt-BR') : '',
    ].join(';');
}

export function exportCreditTopupChargebacksCsv(
    rows: AdminCreditTopupChargebackRow[],
    filenamePrefix = 'chargebacks-recarga-eventfest',
): void {
    const bom = '\uFEFF';
    const content = bom + [CSV_HEADER, ...rows.map(rowToCsvLine)].join('\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `${filenamePrefix}-${date}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

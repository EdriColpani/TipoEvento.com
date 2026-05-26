import type { CreditAccountingRow } from '@/hooks/use-credit-reports';

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

const ROW_KIND_LABELS: Record<string, string> = {
    topup_origin: 'Recarga (origem na empresa)',
    topup: 'Recarga',
    spend_received: 'Consumo (receptor)',
    spend: 'Consumo',
    refund: 'Estorno',
};

function rowKindLabel(kind: string): string {
    return ROW_KIND_LABELS[kind] ?? kind;
}

const CSV_HEADER = [
    'Data/Hora',
    'Tipo',
    'Empresa',
    'Origem recarga',
    'Receptor consumo',
    'ID cliente',
    'Referência',
    'ID spend',
    'Valor bruto',
    'Comissão EventFest',
    'Líquido gestor',
    'Taxa MP',
    'Crédito concedido',
    'Caixa líquido MP',
    'Status repasse MP',
    'ID transferência MP',
    'Evento',
    'Canal',
    'Cross-empresa',
    'Descrição',
].join(';');

function rowToCsvLine(row: CreditAccountingRow): string {
    return [
        new Date(row.transaction_at).toLocaleString('pt-BR'),
        rowKindLabel(row.row_kind),
        escapeCsv(row.company_name ?? ''),
        escapeCsv(row.origin_company_name ?? ''),
        escapeCsv(row.receiver_company_name ?? ''),
        row.client_user_id ?? '',
        row.reference_id ?? '',
        row.spend_order_id ?? '',
        moneyCsv(row.gross_amount),
        moneyCsv(row.platform_amount),
        moneyCsv(row.manager_amount),
        moneyCsv(row.mp_fee_amount),
        moneyCsv(row.credit_granted_amount),
        moneyCsv(row.net_cash_received),
        escapeCsv(row.disbursement_status ?? ''),
        escapeCsv(row.mp_transfer_id ?? ''),
        escapeCsv(row.event_title ?? ''),
        escapeCsv(row.channel ?? ''),
        row.is_cross_company ? 'Sim' : 'Não',
        escapeCsv(row.public_description ?? ''),
    ].join(';');
}

export function exportCreditAccountingCsv(
    rows: CreditAccountingRow[],
    filenamePrefix = 'relatorio-contabil-creditos-eventfest',
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

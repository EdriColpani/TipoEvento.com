import type { AdminSettlementRow } from '@/hooks/use-credit-reports';

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

const STATUS_LABELS: Record<string, string> = {
    pending: 'Retenção D+1',
    released: 'Aguardando TED/PIX',
    paid: 'Pago (manual)',
    clawback: 'Clawback',
    cancelled: 'Cancelado',
};

function statusLabel(status: string): string {
    return STATUS_LABELS[status] ?? status;
}

const CSV_HEADER = [
    'Empresa',
    'Status repasse',
    'Data consumo',
    'Descrição',
    'Canal',
    'Evento',
    'Estabelecimento',
    'Valor bruto',
    'Comissão EventFest',
    'Líquido gestor',
    'Liberação (D+1)',
    'Pago em',
    'Ref. pagamento',
    'Meio pagamento',
    'ID settlement',
    'ID consumo',
].join(';');

function rowToCsvLine(row: AdminSettlementRow): string {
    const platformAmount =
        row.platform_amount != null
            ? Number(row.platform_amount)
            : Number(row.gross_amount ?? 0) - Number(row.manager_amount ?? 0);

    return [
        escapeCsv(row.company_name ?? ''),
        escapeCsv(statusLabel(row.status)),
        row.spend_at ? new Date(row.spend_at).toLocaleString('pt-BR') : '',
        escapeCsv(row.spend_description ?? ''),
        escapeCsv(row.channel ?? ''),
        escapeCsv(row.event_title ?? ''),
        escapeCsv(row.establishment_name ?? ''),
        moneyCsv(row.gross_amount),
        moneyCsv(platformAmount),
        moneyCsv(row.manager_amount),
        row.release_at ? new Date(row.release_at).toLocaleString('pt-BR') : '',
        row.paid_at ? new Date(row.paid_at).toLocaleString('pt-BR') : '',
        escapeCsv(row.payment_reference ?? row.mp_payout_reference ?? ''),
        escapeCsv(row.payment_method ?? ''),
        row.id,
        row.spend_order_id,
    ].join(';');
}

export function exportCreditSettlementsCsv(
    rows: AdminSettlementRow[],
    filenamePrefix = 'repasses-credito-eventfest',
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

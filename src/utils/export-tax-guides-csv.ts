import type { AdminTaxGuideRow } from '@/hooks/use-admin-tax-guides';

function escapeCsv(value: string): string {
    if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
    return value;
}

function moneyCsv(value: number | null | undefined): string {
    return String(Number(value ?? 0)).replace('.', ',');
}

const STATUS: Record<string, string> = {
    open: 'A pagar',
    paid: 'Pago',
    cancelled: 'Cancelado',
};

export function exportTaxGuidesCsv(
    rows: AdminTaxGuideRow[],
    competence: string,
    profitBase: number,
): void {
    const header = [
        'Tipo',
        'Descrição',
        'Competência',
        'Vencimento',
        'Valor da guia',
        'Status',
        'Data de pagamento',
        'Base de lucro no lançamento',
    ].join(';');
    const lines = [
        `Impostos a pagar EventFest;competência ${competence}`,
        `Base de lucro (sintético fiscal);${moneyCsv(profitBase)}`,
        '',
        header,
        ...rows.map((row) =>
            [
                row.tax_type,
                escapeCsv(row.description ?? ''),
                row.competence,
                row.due_date,
                moneyCsv(row.amount),
                STATUS[row.status] ?? row.status,
                row.paid_at ?? '',
                moneyCsv(row.profit_base_snapshot),
            ].join(';'),
        ),
    ];
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `impostos-eventfest-${competence}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

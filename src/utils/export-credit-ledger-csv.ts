import type { CreditLedgerEntry } from '@/hooks/use-client-credit-wallet';

function escapeCsv(value: string): string {
    if (/[",\n\r]/.test(value)) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

export function exportCreditLedgerCsv(entries: CreditLedgerEntry[], filenamePrefix = 'extrato-creditos-eventfest'): void {
    const header = [
        'Data',
        'Tipo',
        'Valor',
        'Saldo após',
        'Descrição',
    ].join(';');

    const rows = entries.map((e) =>
        [
            new Date(e.created_at).toLocaleString('pt-BR'),
            e.entry_type,
            String(e.amount).replace('.', ','),
            String(e.balance_after).replace('.', ','),
            escapeCsv(e.public_description),
        ].join(';'),
    );

    const bom = '\uFEFF';
    const content = bom + [header, ...rows].join('\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `${filenamePrefix}-${date}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

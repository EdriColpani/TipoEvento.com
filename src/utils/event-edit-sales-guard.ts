/** Resposta de get_event_edit_sales_guard (Supabase RPC). */
export interface EventEditSalesGuard {
    sold_count: number;
    paid_receivables_count: number;
    free_registrations_count: number;
    batch_sold_count?: number;
    has_sales: boolean;
    /** Após vendas: gestor pode só aumentar quantidade dos lotes. */
    allow_quantity_increase?: boolean;
    min_capacity: number;
}

export type LockedBatchSnapshot = {
    id?: string;
    name: string;
    quantity: string;
    price: string;
    start_date: string;
    end_date: string;
};

export type LockedTurmaSnapshot = {
    nome: string;
    capacity: number;
};

function normalizePriceKey(price: string): string {
    const n = parseFloat(String(price || '0').replace(',', '.'));
    return Number.isNaN(n) ? '' : n.toFixed(2);
}

function dateKey(d: Date | undefined): string {
    if (!d) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function snapshotBatchesForLock(
    batches: Array<{
        id?: string;
        name?: string;
        quantity?: string;
        price?: string;
        start_date?: Date;
        end_date?: Date;
    }> | undefined,
): LockedBatchSnapshot[] {
    return (batches ?? []).map((b) => ({
        id: b.id,
        name: (b.name ?? '').trim(),
        quantity: String(b.quantity ?? '').trim(),
        price: normalizePriceKey(String(b.price ?? '')),
        start_date: dateKey(b.start_date),
        end_date: dateKey(b.end_date),
    }));
}

export function batchesDifferFromSnapshot(
    current: Array<{
        name?: string;
        quantity?: string;
        price?: string;
        start_date?: Date;
        end_date?: Date;
    }> | undefined,
    snapshot: LockedBatchSnapshot[],
): boolean {
    const cur = snapshotBatchesForLock(current);
    if (cur.length !== snapshot.length) return true;
    return cur.some((b, i) => {
        const s = snapshot[i];
        if (!s) return true;
        return (
            b.name !== s.name ||
            b.quantity !== s.quantity ||
            b.price !== s.price ||
            b.start_date !== s.start_date ||
            b.end_date !== s.end_date
        );
    });
}

/**
 * Após vendas: permite só aumento de quantity; nome/preço/datas/nº de lotes ficam iguais.
 * Retorna mensagem de erro ou null se ok.
 */
export function batchesIncreaseOnlyViolation(
    current: Array<{
        name?: string;
        quantity?: string;
        price?: string;
        start_date?: Date;
        end_date?: Date;
    }> | undefined,
    snapshot: LockedBatchSnapshot[],
): string | null {
    const cur = snapshotBatchesForLock(current);
    if (cur.length !== snapshot.length) {
        return 'Após a primeira venda não é permitido adicionar ou remover lotes. Só é possível aumentar a quantidade dos lotes existentes.';
    }
    for (let i = 0; i < cur.length; i++) {
        const b = cur[i];
        const s = snapshot[i];
        if (!s || !b) return 'Lotes inconsistentes com o cadastro original.';
        if (b.name !== s.name || b.price !== s.price || b.start_date !== s.start_date || b.end_date !== s.end_date) {
            return 'Após a primeira venda, nome, preço e datas dos lotes não podem ser alterados. Só a quantidade pode aumentar.';
        }
        const curQty = Number(String(b.quantity).replace(/\D/g, '')) || 0;
        const lockQty = Number(String(s.quantity).replace(/\D/g, '')) || 0;
        if (curQty < lockQty) {
            return `A quantidade do lote "${s.name || i + 1}" não pode ser menor que ${lockQty.toLocaleString('pt-BR')} (já cadastrada após vendas).`;
        }
    }
    return null;
}

export function turmasDifferFromSnapshot(
    draft: Array<{ nome: string; capacity: string }>,
    snapshot: LockedTurmaSnapshot[],
): boolean {
    const normalized = draft
        .map((t, idx) => ({
            nome: (t.nome || '').trim() || `Turma ${idx + 1}`,
            capacity: Number(t.capacity),
        }))
        .filter((t) => t.capacity >= 0 && t.nome.length > 0);

    if (normalized.length !== snapshot.length) return true;
    return normalized.some((t, idx) => {
        const s = snapshot[idx];
        if (!s) return true;
        return s.nome !== t.nome || s.capacity !== t.capacity;
    });
}

export function salesGuardLockedMessage(guard: EventEditSalesGuard): string {
    const parts: string[] = [];
    if (guard.sold_count > 0) {
        parts.push(
            `${guard.sold_count} ingresso${guard.sold_count === 1 ? '' : 's'} vendido${guard.sold_count === 1 ? '' : 's'}`,
        );
    }
    if (guard.free_registrations_count > 0) {
        parts.push(
            `${guard.free_registrations_count} inscriç${guard.free_registrations_count === 1 ? 'ão' : 'ões'} gratuita${guard.free_registrations_count === 1 ? '' : 's'}`,
        );
    }
    if (guard.paid_receivables_count > 0 && guard.sold_count === 0) {
        parts.push(
            `${guard.paid_receivables_count} pagamento${guard.paid_receivables_count === 1 ? '' : 's'} confirmado${guard.paid_receivables_count === 1 ? '' : 's'}`,
        );
    }
    const summary = parts.length > 0 ? parts.join(' · ') : 'vendas ou inscrições existentes';
    return `${summary}. Preço, nome dos lotes e tipo do evento (pago/gratuito) ficam travados. A quantidade de cada lote só pode aumentar. O percentual de comissão do evento já está congelado.`;
}

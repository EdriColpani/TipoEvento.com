/** Resposta de get_event_edit_sales_guard (Supabase RPC). */
export interface EventEditSalesGuard {
    sold_count: number;
    paid_receivables_count: number;
    free_registrations_count: number;
    has_sales: boolean;
    min_capacity: number;
}

export type LockedBatchSnapshot = {
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
        name?: string;
        quantity?: string;
        price?: string;
        start_date?: Date;
        end_date?: Date;
    }> | undefined,
): LockedBatchSnapshot[] {
    return (batches ?? []).map((b) => ({
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
    return `${summary}. Preço, quantidade dos lotes e tipo do evento (pago/gratuito) não podem ser alterados. Você ainda pode atualizar local, endereço, imagens e descrição.`;
}

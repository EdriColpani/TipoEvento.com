import { supabase } from '@/integrations/supabase/client';
import { parseEdgeFunctionError } from '@/utils/edge-function-error';
import { emitReceivableTickets } from '@/hooks/use-my-tickets';

export type ReconcilePurchaseResult = {
    ok: boolean;
    message: string;
    ticketsEmitted: number;
    paymentStatus?: string;
};

/**
 * Concilia compra no MP + emite ingressos. Não lança exceção — retorna mensagem para UI.
 */
export async function reconcilePurchase(transactionId: string): Promise<ReconcilePurchaseResult> {
    let ticketsEmitted = 0;

    try {
        const emitResult = await emitReceivableTickets(transactionId);
        if (emitResult.ok) {
            ticketsEmitted = emitResult.updated ?? 0;
        }
    } catch (emitErr) {
        console.warn('emitReceivableTickets:', emitErr);
    }

    const { data, error } = await supabase.functions.invoke('check-payment-status', {
        body: { transactionId },
    });

    if (error) {
        const msg = await parseEdgeFunctionError(error, data);
        if (ticketsEmitted > 0) {
            return {
                ok: true,
                message: `${ticketsEmitted} ingresso(s) emitido(s). Falha ao consultar MP: ${msg}`,
                ticketsEmitted,
            };
        }
        return { ok: false, message: msg, ticketsEmitted: 0 };
    }

    const paymentStatus = (data?.paymentStatus as string) || 'desconhecido';
    const detail = data?.paymentStatusDetail ? ` (${data.paymentStatusDetail})` : '';
    const fromEdge = Number(data?.ticketsEmitted ?? 0);
    ticketsEmitted = Math.max(ticketsEmitted, fromEdge);
    const assigned = Number(data?.ticketsAssigned ?? 0);
    const expected = Number(data?.ticketsExpected ?? 0);

    if (ticketsEmitted > 0 || (expected > 0 && assigned >= expected)) {
        return {
            ok: true,
            message: `Ingresso(s) liberado(s). Status MP: ${paymentStatus}${detail}`,
            ticketsEmitted,
            paymentStatus,
        };
    }

    if (data?.requiresAttention) {
        const extra = data?.processingResult ? ` ${data.processingResult}` : '';
        return {
            ok: false,
            message: `Pagamento aprovado no MP, mas a emissão do ingresso ainda não concluiu.${extra}`,
            ticketsEmitted,
            paymentStatus,
        };
    }

    return {
        ok: true,
        message: `Status atualizado: ${paymentStatus}${detail}`,
        ticketsEmitted,
        paymentStatus,
    };
}

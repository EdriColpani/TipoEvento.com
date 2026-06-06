import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Loader2, Info, ExternalLink, Gift } from 'lucide-react';
import { useEventBatchInventorySummary } from '@/hooks/use-event-batch-inventory-summary';

const formatQty = (n: number) => n.toLocaleString('pt-BR');
const formatPrice = (n: number) =>
    n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface EventBatchInventoryConsultPanelProps {
    eventId: string;
    /** Ex.: tela de geração manual (somente consulta) */
    variant?: 'consultation' | 'inline';
    showEditButton?: boolean;
    /** Botão para tela de pacotes cortesia (default: true em eventos counter) */
    showComplimentaryButton?: boolean;
}

const EventBatchInventoryConsultPanel: React.FC<EventBatchInventoryConsultPanelProps> = ({
    eventId,
    variant = 'consultation',
    showEditButton = true,
    showComplimentaryButton = true,
}) => {
    const navigate = useNavigate();
    const { data, isLoading, isError } = useEventBatchInventorySummary(eventId);

    if (isLoading) {
        return (
            <div className="flex items-center gap-2 rounded-xl border border-yellow-500/20 bg-black/40 p-4 text-sm text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />
                Carregando lotes do evento…
            </div>
        );
    }

    if (isError || !data) {
        return null;
    }

    if (data.inventory_mode !== 'counter') {
        return null;
    }

    const capacityGap =
        data.capacity > 0 ? data.capacity - data.batch_total : null;

    const freeBatches = data.batches.filter((b) => b.price === 0);
    const showComplimentaryAction = showComplimentaryButton && data.inventory_mode === 'counter';
    const hasFreeBatchType = freeBatches.length > 0;

    return (
        <div className="rounded-xl border border-cyan-400/50 bg-cyan-950/60 p-4 text-sm text-cyan-50 space-y-3">
            <div className="flex items-start gap-2">
                <Info className="h-5 w-5 text-cyan-300 shrink-0 mt-0.5" />
                <div>
                    <p className="font-semibold text-white">
                        {variant === 'consultation'
                            ? 'Lotes do evento (somente consulta)'
                            : 'Resumo dos lotes — grande porte'}
                    </p>
                    <p className="text-cyan-100/90 mt-1 text-xs leading-relaxed">
                        {variant === 'consultation' ? (
                            <>
                                Os ingressos de venda online são gerados <strong className="text-white">automaticamente na compra</strong>.
                                Use esta tabela para conferir o rateio por tipo (Standard, VIP, Staff…).
                            </>
                        ) : (
                            <>
                                Cada linha abaixo é um <strong className="text-white">tipo de ingresso</strong>.
                                O nome do lote aparece na portaria e na venda.
                            </>
                        )}
                    </p>
                </div>
            </div>

            {data.batches.length === 0 ? (
                <p className="text-amber-200 text-xs rounded-lg border border-amber-500/30 bg-amber-950/40 p-3">
                    Nenhum lote cadastrado ainda. Salve o evento com lotes (nome = tipo, ex.: Standard, VIP) e quantidades.
                </p>
            ) : (
                <div className="overflow-x-auto rounded-lg border border-cyan-500/20">
                    <table className="w-full text-xs sm:text-sm">
                        <thead>
                            <tr className="border-b border-cyan-500/20 text-cyan-200/80 text-left">
                                <th className="p-2 font-medium">Tipo (lote)</th>
                                <th className="p-2 font-medium text-right">Total</th>
                                <th className="p-2 font-medium text-right hidden sm:table-cell">Vendidos</th>
                                <th className="p-2 font-medium text-right hidden sm:table-cell">Reserv.</th>
                                <th className="p-2 font-medium text-right">Disponível</th>
                                <th className="p-2 font-medium text-right">Preço</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.batches.map((row) => (
                                <tr key={row.batch_id} className="border-b border-cyan-500/10 last:border-0">
                                    <td className="p-2 text-white font-medium">{row.name}</td>
                                    <td className="p-2 text-right tabular-nums">{formatQty(row.total)}</td>
                                    <td className="p-2 text-right tabular-nums hidden sm:table-cell">{formatQty(row.sold)}</td>
                                    <td className="p-2 text-right tabular-nums hidden sm:table-cell">{formatQty(row.reserved)}</td>
                                    <td className="p-2 text-right tabular-nums text-green-300">{formatQty(row.available)}</td>
                                    <td className="p-2 text-right tabular-nums">
                                        {row.price > 0 ? formatPrice(row.price) : '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="bg-black/30">
                                <td className="p-2 font-semibold text-white">Soma dos lotes</td>
                                <td className="p-2 text-right font-semibold text-white tabular-nums">
                                    {formatQty(data.batch_total)}
                                </td>
                                <td colSpan={4} className="p-2 text-right text-cyan-100/80 text-xs">
                                    {data.capacity > 0 && (
                                        <>
                                            Capacidade do evento:{' '}
                                            <strong className="text-white">{formatQty(data.capacity)}</strong>
                                            {capacityGap !== null && capacityGap !== 0 && (
                                                <span className={capacityGap > 0 ? ' text-amber-300' : ' text-red-300'}>
                                                    {' '}
                                                    ({capacityGap > 0 ? `faltam ${formatQty(capacityGap)}` : `excesso ${formatQty(Math.abs(capacityGap))}`})
                                                </span>
                                            )}
                                        </>
                                    )}
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}

            {(showComplimentaryAction || showEditButton) && (
                <div className="flex flex-wrap gap-2">
                    {showComplimentaryAction && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="bg-black/60 border border-cyan-400/40 text-cyan-200 hover:bg-cyan-950/80 hover:text-white"
                            onClick={() => navigate(`/manager/events/${eventId}/cortesias`)}
                        >
                            <Gift className="h-4 w-4 mr-2" />
                            Enviar pacotes cortesia
                        </Button>
                    )}
                    {showEditButton && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                            onClick={() => navigate(`/manager/events/edit/${eventId}`)}
                        >
                            <ExternalLink className="h-4 w-4 mr-2" />
                            Editar lotes do evento
                        </Button>
                    )}
                </div>
            )}

            {showComplimentaryAction && !hasFreeBatchType && (
                <p className="text-amber-200/90 text-xs">
                    Cadastre um lote com preço R$ 0,00 (ex.: Staff) e salve o evento para liberar o estoque cortesia.
                </p>
            )}
        </div>
    );
};

export default EventBatchInventoryConsultPanel;

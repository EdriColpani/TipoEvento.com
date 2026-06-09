import React from 'react';
import { Rocket } from 'lucide-react';

/**
 * Guia de lotes de ingressos — fluxo padrão para todos os eventos pagos.
 */
const EventGrandePorteGuide: React.FC = () => {
    return (
        <div className="rounded-xl border border-cyan-400/40 bg-cyan-950/50 p-4 space-y-3 text-sm text-cyan-50">
            <div className="flex items-center gap-2 text-white font-semibold">
                <Rocket className="h-5 w-5 text-cyan-300" />
                Como configurar os ingressos
            </div>

            <ol className="list-decimal list-inside space-y-2 text-cyan-100/95 text-xs leading-relaxed">
                <li>
                    Defina a <strong className="text-white">capacidade total</strong> do evento (ex.: 200 ou 50.000).
                </li>
                <li>
                    Crie <strong className="text-white">um lote por tipo</strong> de ingresso. O{' '}
                    <strong className="text-white">nome do lote</strong> é o tipo na portaria (Standard, VIP, Staff…).
                </li>
                <li>
                    Em cada lote, informe a <strong className="text-white">quantidade</strong> daquele tipo (ex.: 150
                    Standard + 50 VIP = 200).
                </li>
                <li>
                    Os QR codes são gerados <strong className="text-white">na venda</strong> — não é necessário emitir
                    ingressos manualmente antes.
                </li>
            </ol>

            <div className="rounded-lg border border-cyan-500/25 bg-black/40 p-3 text-xs">
                <p className="text-cyan-200/90 mb-2 font-medium">Exemplo — evento com 200 lugares</p>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="text-cyan-300/80 border-b border-cyan-500/20">
                                <th className="pb-1 pr-3">Nome do lote (tipo)</th>
                                <th className="pb-1 pr-3 text-right">Quantidade</th>
                                <th className="pb-1 text-right">Preço</th>
                            </tr>
                        </thead>
                        <tbody className="text-white/90">
                            <tr>
                                <td className="py-1 pr-3">Standard</td>
                                <td className="py-1 pr-3 text-right tabular-nums">150</td>
                                <td className="py-1 text-right">R$ 80,00</td>
                            </tr>
                            <tr>
                                <td className="py-1 pr-3">VIP</td>
                                <td className="py-1 pr-3 text-right tabular-nums">50</td>
                                <td className="py-1 text-right">R$ 150,00</td>
                            </tr>
                            <tr className="border-t border-cyan-500/20 font-semibold text-white">
                                <td className="pt-2 pr-3">Total</td>
                                <td className="pt-2 pr-3 text-right tabular-nums">200</td>
                                <td className="pt-2 text-right" />
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p className="text-cyan-200/70 mt-2 text-[11px]">
                    * Lotes com preço zero não aparecem na vitrine online. Use &quot;Enviar pacotes cortesia&quot; para
                    distribuir ingressos Staff.
                </p>
            </div>

            <p className="text-[11px] text-cyan-200/70">
                Eventos com 5.000+ ingressos ativam fila virtual automaticamente. Depois de salvar, valide o checklist
                go-live e clique em <strong className="text-white">Ativar</strong> em Meus Eventos.
            </p>
        </div>
    );
};

export default EventGrandePorteGuide;

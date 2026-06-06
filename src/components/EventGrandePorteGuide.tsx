import React from 'react';
import { Rocket } from 'lucide-react';

interface EventGrandePorteGuideProps {
    active: boolean;
}

/**
 * Explica o modo grande porte no cadastro do evento — quando marcar e como configurar lotes.
 */
const EventGrandePorteGuide: React.FC<EventGrandePorteGuideProps> = ({ active }) => {
    if (!active) {
        return (
            <div className="rounded-xl border border-gray-700/50 bg-black/30 p-4 text-xs text-gray-400">
                <p>
                    <strong className="text-gray-300">Quando usar grande porte?</strong> Eventos com milhares de ingressos
                    (ex.: 5.000, 50.000). Para eventos pequenos, deixe desmarcado e use a emissão manual de pulseiras.
                </p>
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-cyan-400/40 bg-cyan-950/50 p-4 space-y-3 text-sm text-cyan-50">
            <div className="flex items-center gap-2 text-white font-semibold">
                <Rocket className="h-5 w-5 text-cyan-300" />
                Como funciona o evento de grande porte
            </div>

            <ol className="list-decimal list-inside space-y-2 text-cyan-100/95 text-xs leading-relaxed">
                <li>
                    Defina a <strong className="text-white">capacidade total</strong> do evento (ex.: 50.000).
                </li>
                <li>
                    Crie <strong className="text-white">um lote por tipo</strong> de ingresso. O <strong className="text-white">nome do lote</strong> é o
                    tipo na portaria (Standard, VIP, Staff…).
                </li>
                <li>
                    Em cada lote, informe a <strong className="text-white">quantidade</strong> daquele tipo (ex.: 40.000 Standard + 7.000 VIP + 3.000 Staff = 50.000).
                </li>
                <li>
                    Os QR codes são gerados <strong className="text-white">na venda</strong> — não é necessário emitir 50.000 ingressos manualmente antes.
                </li>
            </ol>

            <div className="rounded-lg border border-cyan-500/25 bg-black/40 p-3 text-xs">
                <p className="text-cyan-200/90 mb-2 font-medium">Exemplo — show com 50.000 lugares</p>
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
                            <tr><td className="py-1 pr-3">Standard</td><td className="py-1 pr-3 text-right tabular-nums">40.000</td><td className="py-1 text-right">R$ 150,00</td></tr>
                            <tr><td className="py-1 pr-3">VIP</td><td className="py-1 pr-3 text-right tabular-nums">7.000</td><td className="py-1 text-right">R$ 350,00</td></tr>
                            <tr><td className="py-1 pr-3">Staff</td><td className="py-1 pr-3 text-right tabular-nums">3.000</td><td className="py-1 text-right">cortesia*</td></tr>
                            <tr className="border-t border-cyan-500/20 font-semibold text-white">
                                <td className="pt-2 pr-3">Total</td>
                                <td className="pt-2 pr-3 text-right tabular-nums">50.000</td>
                                <td className="pt-2 text-right" />
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p className="text-cyan-200/70 mt-2 text-[11px]">
                    * Lotes com preço zero não aparecem na vitrine online. Use &quot;Enviar pacotes cortesia&quot; na edição do evento para distribuir ingressos Staff.
                </p>
            </div>

            <p className="text-[11px] text-cyan-200/70">
                Ativa fila virtual, webhook assíncrono e checklist go-live antes de publicar na vitrine.
            </p>
        </div>
    );
};

export default EventGrandePorteGuide;

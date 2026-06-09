import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { useEventGoLiveChecklist } from '@/hooks/use-event-go-live-checklist';
import {
    getGoLiveAutoBlockers,
    getGoLiveFixAction,
    isGoLiveAutoReady,
} from '@/utils/go-live-activation';

interface EventActivationBlockersProps {
    eventId: string;
    inventoryMode?: 'counter' | 'unit_rows' | null;
    isActive: boolean;
    isDraft: boolean;
}

/**
 * Mostra na lista de eventos o que falta para clicar em Ativar (checklist go-live).
 */
const EventActivationBlockers: React.FC<EventActivationBlockersProps> = ({
    eventId,
    inventoryMode,
    isActive,
    isDraft,
}) => {
    const navigate = useNavigate();
    const shouldFetch = !isActive && !isDraft;

    const { data, isLoading } = useEventGoLiveChecklist(eventId, shouldFetch);

    if (isActive || isDraft || !shouldFetch) return null;
    if (isLoading && !data) {
        return (
            <p className="mt-1 text-xs text-gray-500 flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Verificando requisitos para ativar…
            </p>
        );
    }

    if (!data?.applies) return null;

    const blockers = getGoLiveAutoBlockers(data.items);
    const autoReady = isGoLiveAutoReady(data);

    if (autoReady) {
        return (
            <p className="relative z-[1] mt-1 text-xs text-green-300/90 leading-relaxed">
                <CheckCircle2 className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
                <strong className="text-green-200">Pronto para ativar.</strong> Requisitos técnicos OK — clique no
                botão verde <strong className="text-white">Ativar</strong> ao lado. (Itens operacionais do checklist
                são recomendados, não bloqueiam.)
            </p>
        );
    }

    return (
        <div className="relative z-[1] mt-1 text-xs text-amber-300/90 leading-relaxed space-y-1">
            <p className="font-semibold text-amber-200">
                Para ativar, resolva {blockers.length} item(ns) abaixo:
            </p>
            <ul className="space-y-1 pl-1">
                {blockers.map((item) => {
                    const fix = getGoLiveFixAction(item.key, eventId);
                    return (
                        <li key={item.key} className="flex items-start gap-1.5">
                            <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                            <span>
                                <strong className="text-white">{item.label}</strong>
                                {item.message ? ` — ${item.message}` : ''}
                                {fix && (
                                    <>
                                        {' '}
                                        <button
                                            type="button"
                                            className="text-yellow-400 underline underline-offset-2 hover:text-yellow-300 font-medium"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                navigate(fix.path);
                                            }}
                                        >
                                            {fix.label}
                                        </button>
                                    </>
                                )}
                            </span>
                        </li>
                    );
                })}
            </ul>
            {data.ready_count != null && data.required_count != null && (
                <p className="text-gray-400 flex items-center gap-1 pt-1">
                    <AlertTriangle className="h-3 w-3" />
                    Checklist completo: {data.ready_count}/{data.required_count} —{' '}
                    <button
                        type="button"
                        className="text-cyan-300 underline underline-offset-2"
                        onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/manager/events/edit/${eventId}`);
                        }}
                    >
                        abrir na edição do evento
                    </button>
                </p>
            )}
        </div>
    );
};

export default EventActivationBlockers;

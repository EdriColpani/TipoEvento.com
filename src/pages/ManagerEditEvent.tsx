import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowLeft } from 'lucide-react';
import { showError } from '@/utils/toast';
import EventFormSteps from '@/components/EventFormSteps';
import EventGoLiveChecklist from '@/components/EventGoLiveChecklist';
import EventBatchInventoryConsultPanel from '@/components/EventBatchInventoryConsultPanel';
import { parseEventLocalDay } from '@/utils/format-event-date';
import { highlightsToText } from '@/utils/event-highlights';
import { usePageAuth } from '@/hooks/use-page-auth';
import { restGet } from '@/utils/supabase-rest';
import {
    fetchProfileTipoUsuarioIdResilient,
    normalizeTipoUsuarioId,
} from '@/utils/fetch-profile-tipo';
import { ENTRY_QR_DEFAULT_TTL_SECONDS } from '@/constants/entry-qr';
import { isEventLifecycleEnded } from '@/utils/event-lifecycle';

const ADMIN_MASTER_USER_TYPE_ID = 1;

interface EventFormData {
    title: string;
    description: string;
    highlights_text?: string;
    date: Date | undefined;
    time: string;
    location: string;
    address: string;
    address_lat?: number | null;
    address_lng?: number | null;
    address_place_id?: string | null;
    card_image_url: string;
    exposure_card_image_url: string;
    banner_image_url: string;
    min_age: number | string;
    category: string;
    capacity: number | string;
    duration: string;
    is_paid?: boolean;
    allow_printed_tickets?: boolean;
    entry_qr_ttl_seconds?: number;
    validator_show_holder?: boolean;
    credit_consumption_enabled?: boolean;
    ticket_price?: number | string | null;
    contract_id?: string;
}

type EventRow = Record<string, unknown> & {
    id?: string;
    title?: string;
    description?: string;
    highlights?: unknown;
    date?: string;
    time?: string;
    location?: string;
    address?: string;
    address_lat?: number | null;
    address_lng?: number | null;
    address_place_id?: string | null;
    image_url?: string;
    exposure_card_image_url?: string;
    banner_image_url?: string;
    min_age?: number;
    category?: string;
    capacity?: number;
    duration?: string;
    is_paid?: boolean;
    allow_printed_tickets?: boolean;
    entry_qr_ttl_seconds?: number;
    validator_show_holder?: boolean;
    credit_consumption_enabled?: boolean;
    ticket_price?: number | null;
    contract_id?: string | null;
    created_by?: string | null;
    inventory_mode?: string;
    lifecycle_ended_at?: string | null;
};

function mapEventToForm(eventData: EventRow): EventFormData {
    const ttl = Number(eventData.entry_qr_ttl_seconds);
    return {
        title: eventData.title || '',
        description: eventData.description || '',
        highlights_text: highlightsToText(eventData.highlights),
        date: eventData.date ? parseEventLocalDay(String(eventData.date)) ?? undefined : undefined,
        time: eventData.time || '',
        location: eventData.location || '',
        address: eventData.address || '',
        address_lat: eventData.address_lat ?? null,
        address_lng: eventData.address_lng ?? null,
        address_place_id: eventData.address_place_id ?? null,
        card_image_url: eventData.image_url || '',
        exposure_card_image_url: eventData.exposure_card_image_url || '',
        banner_image_url: eventData.banner_image_url || '',
        min_age: eventData.min_age || 0,
        category: eventData.category || '',
        capacity: eventData.capacity || 0,
        duration: eventData.duration || '',
        is_paid: Boolean(eventData.is_paid),
        allow_printed_tickets: Boolean(eventData.allow_printed_tickets),
        entry_qr_ttl_seconds: Number.isFinite(ttl) && ttl > 0 ? ttl : ENTRY_QR_DEFAULT_TTL_SECONDS,
        validator_show_holder: eventData.validator_show_holder !== false,
        credit_consumption_enabled: Boolean(eventData.credit_consumption_enabled),
        ticket_price: eventData.ticket_price ?? null,
        contract_id: eventData.contract_id ?? undefined,
    };
}

const ManagerEditEvent: React.FC = () => {
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const [initialEventData, setInitialEventData] = useState<EventFormData | null>(null);
    const [inventoryMode, setInventoryMode] = useState<string>('unit_rows');
    const [isFetching, setIsFetching] = useState(true);
    const { userId: authUserId, authPending, sessionReady } = usePageAuth();
    const userId = authUserId ?? null;

    useEffect(() => {
        if (!sessionReady || userId) return;
        showError('Sessão expirada ou não autenticada.');
        navigate('/login');
        setIsFetching(false);
    }, [sessionReady, userId, navigate]);

    useEffect(() => {
        if (!userId || !id) return;

        let cancelled = false;

        const loadEvent = async () => {
            setIsFetching(true);
            try {
                const tipo = await fetchProfileTipoUsuarioIdResilient(userId);
                const isAdminMaster = normalizeTipoUsuarioId(tipo) === ADMIN_MASTER_USER_TYPE_ID;

                const rows = await restGet<EventRow[]>(
                    `events?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
                    15_000,
                );
                const eventData = rows?.[0];

                if (cancelled) return;

                if (!eventData) {
                    showError('Evento não encontrado ou você não tem permissão para editá-lo.');
                    navigate('/manager/events');
                    return;
                }

                if (!isAdminMaster && eventData.created_by !== userId) {
                    showError(
                        'Este evento pertence a outro usuário ou ao administrador. Você só pode editar eventos que você criou.',
                    );
                    navigate('/manager/events');
                    return;
                }

                const eventEnded =
                    Boolean(eventData.lifecycle_ended_at) ||
                    isEventLifecycleEnded(
                        eventData.date != null ? String(eventData.date) : null,
                        eventData.time != null ? String(eventData.time) : null,
                    );
                if (eventEnded && !isAdminMaster) {
                    showError(
                        'Este evento já foi realizado. Somente o administrador pode editar eventos encerrados.',
                    );
                    navigate('/manager/events');
                    return;
                }

                setInventoryMode(eventData.inventory_mode ?? 'unit_rows');
                setInitialEventData(mapEventToForm(eventData));
            } catch (error) {
                if (cancelled) return;
                console.error('Erro ao buscar evento:', error);
                const message = error instanceof Error ? error.message : '';
                const timedOut =
                    message.toLowerCase().includes('tempo esgotado') ||
                    message.toLowerCase().includes('aborted') ||
                    (error instanceof DOMException && error.name === 'AbortError');
                showError(
                    timedOut
                        ? 'Tempo esgotado ao carregar o evento. Verifique a conexão e tente novamente.'
                        : 'Evento não encontrado ou você não tem permissão para editá-lo.',
                );
                navigate('/manager/events');
            } finally {
                if (!cancelled) setIsFetching(false);
            }
        };

        void loadEvent();

        return () => {
            cancelled = true;
        };
    }, [id, userId, navigate]);

    const handleSaveSuccess = () => {
        navigate('/manager/events');
    };

    if (authPending || isFetching || (userId && !initialEventData)) {
        return (
            <div className="max-w-4xl mx-auto px-4 sm:px-0 text-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando detalhes do evento...</p>
            </div>
        );
    }

    if (!initialEventData) {
        return null;
    }

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-0">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 mb-4 sm:mb-0">
                    Editar Evento: {initialEventData.title}
                </h1>
                <Button
                    onClick={() => navigate('/manager/events')}
                    variant="outline"
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 text-sm"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar para a Lista
                </Button>
            </div>

            {id && <EventGoLiveChecklist eventId={id} />}

            {id && inventoryMode === 'counter' && (
                <div className="mb-6">
                    <EventBatchInventoryConsultPanel
                        eventId={id}
                        variant="inline"
                        showEditButton={false}
                    />
                </div>
            )}

            <EventFormSteps
                eventId={id}
                initialData={initialEventData}
                onSaveSuccess={handleSaveSuccess}
                onCancel={() => navigate('/manager/events')}
            />
        </div>
    );
};

export default ManagerEditEvent;

import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft } from 'lucide-react';
import { showError } from '@/utils/toast';
import { supabase } from '@/integrations/supabase/client';
import EventFormSteps from '@/components/EventFormSteps';
import { parseEventLocalDay } from '@/utils/format-event-date';
import { useProfile } from '@/hooks/use-profile';

const ADMIN_MASTER_USER_TYPE_ID = 1;

// Define the structure for the form data
interface EventFormData {
    title: string;
    description: string;
    date: Date | undefined;
    time: string;
    location: string;
    address: string;
    card_image_url: string; // RENOMEADO
    exposure_card_image_url: string; // NOVO
    banner_image_url: string;
    min_age: number | string;
    category: string;
    capacity: number | string;
    duration: string;
}

const ManagerEditEvent: React.FC = () => {
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const [initialEventData, setInitialEventData] = useState<EventFormData | null>(null);
    const [isFetching, setIsFetching] = useState(true);
    const [userId, setUserId] = useState<string | null>(null);

    const { profile, isLoading: isLoadingProfile, isFetched: isProfileFetched } = useProfile(
        userId ?? undefined,
    );

    useEffect(() => {
        const initUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();

            if (!user) {
                showError('Sessão expirada ou não autenticada.');
                navigate('/manager/login');
                setIsFetching(false);
                return;
            }
            setUserId(user.id);
        };

        initUser();
    }, [navigate]);

    useEffect(() => {
        if (!userId || !id) {
            return;
        }
        if (!isProfileFetched || isLoadingProfile) {
            return;
        }

        const loadEvent = async () => {
            setIsFetching(true);

            const isAdminMaster = profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID;

            const { data: eventData, error: fetchError } = await supabase
                .from('events')
                .select('*')
                .eq('id', id)
                .single();

            if (fetchError || !eventData) {
                console.error('Erro ao buscar evento:', fetchError);
                showError('Evento não encontrado ou você não tem permissão para editá-lo.');
                navigate('/manager/events');
                setIsFetching(false);
                return;
            }

            if (!isAdminMaster && eventData.created_by !== userId) {
                showError('Este evento pertence a outro usuário ou ao administrador. Você só pode editar eventos que você criou.');
                navigate('/manager/events');
                setIsFetching(false);
                return;
            }

            setInitialEventData({
                title: eventData.title || '',
                description: eventData.description || '',
                date: eventData.date ? parseEventLocalDay(eventData.date) ?? undefined : undefined,
                time: eventData.time || '',
                location: eventData.location || '',
                address: eventData.address || '',
                card_image_url: eventData.image_url || '',
                exposure_card_image_url: eventData.exposure_card_image_url || '',
                banner_image_url: eventData.banner_image_url || '',
                min_age: eventData.min_age || 0,
                category: eventData.category || '',
                capacity: eventData.capacity || 0,
                duration: eventData.duration || '',
            });
            setIsFetching(false);
        };

        loadEvent();
    }, [id, userId, profile, isProfileFetched, isLoadingProfile, navigate]);

    const handleSaveSuccess = () => {
        navigate('/manager/events');
    };

    if (isFetching || !initialEventData || !userId) {
        return (
            <div className="max-w-4xl mx-auto px-4 sm:px-0 text-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando detalhes do evento...</p>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-0">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 mb-4 sm:mb-0">Editar Evento: {initialEventData.title}</h1>
                <Button 
                    onClick={() => navigate('/manager/events')}
                    variant="outline"
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 text-sm"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar para a Lista
                </Button>
            </div>

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
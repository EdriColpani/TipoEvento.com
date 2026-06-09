import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/hooks/use-profile';
import { useManagerEvents } from '@/hooks/use-manager-events';

const ADMIN_MASTER_USER_TYPE_ID = 1;

/**
 * Lembrete obrigatório: gerar ingressos não ativa o evento na vitrine.
 */
const EventActivationReminderBanner: React.FC = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState<string | undefined>();

    useEffect(() => {
        void supabase.auth.getUser().then(({ data: { user } }) => {
            setUserId(user?.id);
        });
    }, []);

    const { profile } = useProfile(userId);
    const isAdminMaster = profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID;
    const { events } = useManagerEvents(userId, isAdminMaster);

    if (!userId || isAdminMaster) {
        return null;
    }

    const pendingActivation = events.filter(
        (e) => !e.is_active && !e.is_draft && !e.auto_deactivated_at,
    );

    return (
        <div className="mb-6 flex flex-col sm:flex-row sm:items-start gap-4 rounded-xl border border-amber-500/50 bg-amber-950/40 p-4 text-sm text-amber-50 shadow-lg shadow-amber-900/20">
            <AlertTriangle className="h-6 w-6 text-amber-400 shrink-0 mt-0.5" aria-hidden />
            <div className="flex-1 space-y-2">
                <p className="font-semibold text-white text-base">
                    Importante: ative o evento em Meus Eventos
                </p>
                <p className="text-amber-100/95 text-xs sm:text-sm leading-relaxed">
                    Cadastrar ou gerar ingressos <strong className="text-white">não publica</strong> o evento na
                    vitrine. Depois de concluir os ingressos e lotes, vá em{' '}
                    <strong className="text-white">Meus Eventos</strong> e clique no botão{' '}
                    <strong className="text-white">Ativar</strong>. Sem essa etapa, o público não vê o evento nem
                    consegue comprar ingressos online.
                </p>
                {pendingActivation.length > 0 && (
                    <p className="text-amber-200 text-xs">
                        {pendingActivation.length === 1
                            ? `1 evento aguardando ativação: ${pendingActivation[0].title}.`
                            : `${pendingActivation.length} eventos aguardando ativação.`}
                    </p>
                )}
            </div>
            <Button
                type="button"
                onClick={() => navigate('/manager/events')}
                className="shrink-0 bg-amber-500 text-black hover:bg-amber-400 font-semibold"
            >
                Ir para Meus Eventos
            </Button>
        </div>
    );
};

export default EventActivationReminderBanner;

import React, { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Trash2 } from 'lucide-react';
import { callRpcPublicRest } from '@/utils/supabase-rest-rpc';
import { showError, showSuccess } from '@/utils/toast';
import {
    appendStoredLandingFeedback,
    readStoredLandingFeedback,
    removeStoredLandingFeedback,
    type StoredLandingFeedback,
} from '@/utils/landing-feedback-storage';

const LandingFeedbackPanel: React.FC = () => {
    const [message, setMessage] = useState('');
    const [sending, setSending] = useState(false);
    const [items, setItems] = useState<StoredLandingFeedback[]>(() => readStoredLandingFeedback());

    const refreshList = useCallback(() => {
        setItems(readStoredLandingFeedback());
    }, []);

    const handleSubmit = async () => {
        const trimmed = message.trim();
        if (trimmed.length < 5) {
            showError('Escreva um feedback com pelo menos 5 caracteres.');
            return;
        }
        setSending(true);
        try {
            const data = await callRpcPublicRest<{ id?: string } | null>(
                'create_public_landing_feedback',
                { p_message: trimmed },
            );

            const id =
                data && typeof data === 'object' && 'id' in data
                    ? String(data.id)
                    : crypto.randomUUID();

            appendStoredLandingFeedback({
                id,
                message: trimmed,
                created_at: new Date().toISOString(),
            });
            setMessage('');
            refreshList();
            showSuccess('Feedback enviado. Obrigado!');
        } catch (e: unknown) {
            const fallbackId = crypto.randomUUID();
            appendStoredLandingFeedback({
                id: fallbackId,
                message: trimmed,
                created_at: new Date().toISOString(),
            });
            setMessage('');
            refreshList();
            if (e instanceof Error && e.message.includes('function')) {
                showSuccess('Feedback salvo localmente (ative a migration landing_feedback no Supabase).');
            } else {
                showError(e instanceof Error ? e.message : 'Não foi possível enviar o feedback.');
            }
        } finally {
            setSending(false);
        }
    };

    const handleDelete = (id: string) => {
        removeStoredLandingFeedback(id);
        refreshList();
        showSuccess('Feedback removido desta lista.');
    };

    return (
        <div className="space-y-5">
            <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Conte o que achou da plataforma, sugestões ou problemas..."
                rows={5}
                className="w-full min-h-[120px] rounded-md bg-black/60 border border-cyan-400/30 text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400/30"
                aria-label="Seu feedback"
            />
            <Button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={sending}
                className="bg-cyan-500 text-black hover:bg-cyan-400 w-full sm:w-auto"
            >
                {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Enviar feedback
            </Button>

            {items.length > 0 ? (
                <div className="border-t border-cyan-400/20 pt-4 space-y-3">
                    <p className="text-sm text-gray-400">Seus envios neste navegador:</p>
                    <ul className="space-y-2 max-h-48 overflow-y-auto">
                        {items.map((item) => (
                            <li
                                key={item.id}
                                className="flex gap-3 items-start rounded-lg border border-cyan-400/15 bg-black/40 p-3"
                            >
                                <p className="text-sm text-gray-300 flex-1 whitespace-pre-wrap">
                                    {item.message}
                                </p>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="shrink-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                    onClick={() => handleDelete(item.id)}
                                    aria-label="Remover feedback"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </div>
    );
};

export default LandingFeedbackPanel;

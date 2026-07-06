import React, { useEffect, useState } from 'react';
import { ArrowLeft, Loader2, Mail } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { usePageAuth } from '@/hooks/use-page-auth';
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/hooks/use-profile';
import { showError, showSuccess } from '@/utils/toast';

type ContactMessage = {
    id: string;
    name: string;
    phone: string;
    message: string;
    status: 'new' | 'read' | 'resolved';
    created_at: string;
    read_at: string | null;
    resolved_at: string | null;
    handled_by_label: string | null;
};

const ADMIN_MASTER_USER_TYPE_ID = 1;

const AdminContactMessages: React.FC = () => {
    const navigate = useNavigate();
    const { userId } = usePageAuth();
    const [statusFilter, setStatusFilter] = useState<'all' | 'new' | 'read' | 'resolved'>('all');
    const [items, setItems] = useState<ContactMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const [updatingId, setUpdatingId] = useState<string | null>(null);
    const { profile, isLoading: loadingProfile } = useProfile(userId);

    const loadItems = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase.rpc('list_admin_contact_messages', {
                p_status: statusFilter === 'all' ? null : statusFilter,
                p_limit: 150,
                p_offset: 0,
            });
            if (error) throw error;
            const payload = (data ?? {}) as { items?: ContactMessage[] };
            setItems(payload.items ?? []);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : '';
            if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
                showError(
                    'Função de mensagens não encontrada no banco. Aplique a migration 20260630170000_contact_messages.sql (supabase db push).',
                );
            } else {
                showError(msg || 'Erro ao carregar mensagens.');
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!loadingProfile && userId && profile?.tipo_usuario_id !== ADMIN_MASTER_USER_TYPE_ID) {
            showError('Acesso negado. Apenas Admin Master.');
            navigate('/manager/dashboard');
        }
    }, [loadingProfile, userId, profile?.tipo_usuario_id, navigate]);

    useEffect(() => {
        if (!loadingProfile && profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID) {
            loadItems();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statusFilter, loadingProfile, profile?.tipo_usuario_id]);

    const updateStatus = async (id: string, status: 'new' | 'read' | 'resolved') => {
        setUpdatingId(id);
        try {
            const { error } = await supabase.rpc('update_admin_contact_message_status', {
                p_message_id: id,
                p_status: status,
            });
            if (error) throw error;
            showSuccess('Status atualizado.');
            await loadItems();
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Erro ao atualizar status.');
        } finally {
            setUpdatingId(null);
        }
    };

    if (loadingProfile && userId) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-cyan-400 mx-auto mb-4" />
                <p className="text-gray-400">Carregando...</p>
            </div>
        );
    }

    if (profile?.tipo_usuario_id !== ADMIN_MASTER_USER_TYPE_ID) return null;

    return (
        <div className="max-w-6xl mx-auto">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-serif text-cyan-400 flex items-center gap-2">
                        <Mail className="h-7 w-7" />
                        Mensagens de Contato
                    </h1>
                    <p className="text-gray-400 text-sm mt-1">
                        Mensagens recebidas pela landing page.
                    </p>
                </div>
                <Button type="button" variant="outline" onClick={() => navigate('/admin/dashboard')}>
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    Voltar
                </Button>
            </div>

            <div className="max-w-xs mb-4">
                <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'all' | 'new' | 'read' | 'resolved')}>
                    <SelectTrigger className="bg-black/60 border-cyan-400/30 text-white">
                        <SelectValue placeholder="Filtrar status" />
                    </SelectTrigger>
                    <SelectContent className="bg-black border-cyan-400/30 text-white">
                        <SelectItem value="all">Todos</SelectItem>
                        <SelectItem value="new">Nova</SelectItem>
                        <SelectItem value="read">Lida</SelectItem>
                        <SelectItem value="resolved">Resolvida</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <Card className="bg-black/40 border-cyan-400/20">
                <CardHeader>
                    <CardTitle className="text-white">Caixa de entrada</CardTitle>
                    <CardDescription className="text-gray-400">
                        {items.length} mensagem(ns) no filtro atual.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
                    ) : items.length === 0 ? (
                        <p className="text-gray-500 text-sm">Nenhuma mensagem encontrada.</p>
                    ) : (
                        <ul className="space-y-3">
                            {items.map((m) => (
                                <li key={m.id} className="border border-cyan-400/20 rounded-xl p-4 space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="text-white font-medium">{m.name}</p>
                                        <span className="text-xs text-cyan-400 uppercase">{m.status}</span>
                                    </div>
                                    <p className="text-gray-300 text-sm">Telefone: {m.phone}</p>
                                    <p className="text-gray-300 text-sm whitespace-pre-wrap">{m.message}</p>
                                    <p className="text-xs text-gray-500">
                                        {new Date(m.created_at).toLocaleString('pt-BR')}
                                        {m.handled_by_label ? ` · por ${m.handled_by_label}` : ''}
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="border-cyan-400/40 text-cyan-400"
                                            disabled={updatingId === m.id}
                                            onClick={() => updateStatus(m.id, 'read')}
                                        >
                                            Marcar como lida
                                        </Button>
                                        <Button
                                            size="sm"
                                            className="bg-cyan-400 text-black hover:bg-cyan-300"
                                            disabled={updatingId === m.id}
                                            onClick={() => updateStatus(m.id, 'resolved')}
                                        >
                                            Resolver
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="border-cyan-400/40 text-cyan-400"
                                            disabled={updatingId === m.id}
                                            onClick={() => updateStatus(m.id, 'new')}
                                        >
                                            Voltar para nova
                                        </Button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

export default AdminContactMessages;

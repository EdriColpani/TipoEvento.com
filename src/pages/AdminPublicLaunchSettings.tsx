import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ArrowLeft, Globe, Loader2, Rocket, Eye, Info, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { usePageAuth } from '@/hooks/use-page-auth';
import { useProfile } from '@/hooks/use-profile';
import { showError, showLoading, showSuccess, dismissToast } from '@/utils/toast';
import { useInvalidatePublicLaunchMode } from '@/hooks/use-public-launch-mode';
import { normalizePublicLaunchMode, type PublicLaunchMode } from '@/utils/public-launch-access';

const ADMIN_MASTER_USER_TYPE_ID = 1;

const AdminPublicLaunchSettings: React.FC = () => {
    const navigate = useNavigate();
    const invalidateLaunchMode = useInvalidatePublicLaunchMode();
    const { userId, authPending, sessionReady, bootExpired } = usePageAuth();
    const { profile, isLoading: isLoadingProfile } = useProfile(userId);
    const [mode, setMode] = useState<PublicLaunchMode>('preview');
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const isAdminMaster = Number(profile?.tipo_usuario_id) === ADMIN_MASTER_USER_TYPE_ID;
    const isPreview = mode === 'preview';

    useEffect(() => {
        if (authPending) return;
        if (!userId && (sessionReady || bootExpired)) {
            showError('Sessão expirada. Faça login novamente.');
            navigate('/login');
            return;
        }

        const load = async () => {
            try {
                const { data, error } = await supabase
                    .from('system_billing_settings')
                    .select('public_launch_mode')
                    .eq('id', 1)
                    .maybeSingle();

                if (error && error.code !== 'PGRST116' && !error.message?.includes('column')) {
                    showError('Erro ao carregar configuração do site público.');
                } else {
                    setMode(normalizePublicLaunchMode(data?.public_launch_mode ?? 'preview'));
                }
            } catch (e) {
                console.warn('public_launch_mode load failed', e);
            } finally {
                setIsLoading(false);
            }
        };
        void load();
    }, [authPending, userId, sessionReady, bootExpired, navigate]);

    const handleSave = async () => {
        setIsSaving(true);
        const toastId = showLoading('Salvando configuração do site público...');
        try {
            const { error } = await supabase.from('system_billing_settings').upsert(
                {
                    id: 1,
                    public_launch_mode: mode,
                    updated_at: new Date().toISOString(),
                    updated_by: userId ?? null,
                },
                { onConflict: 'id' },
            );

            if (error) throw error;

            invalidateLaunchMode();
            dismissToast(toastId);
            showSuccess(
                isPreview
                    ? 'Modo pré-lançamento ativado. Visitantes verão a página institucional.'
                    : 'Site público ao vivo. A vitrine completa está visível para todos.',
            );
        } catch (e: unknown) {
            dismissToast(toastId);
            showError(e instanceof Error ? e.message : 'Não foi possível salvar a configuração.');
        } finally {
            setIsSaving(false);
        }
    };

    if (authPending || isLoading || (userId && isLoadingProfile && !profile)) {
        return (
            <div className="max-w-4xl mx-auto px-4 sm:px-0 text-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando configurações...</p>
            </div>
        );
    }

    if (!isAdminMaster) {
        return (
            <div className="max-w-4xl mx-auto px-4 text-center py-20 text-gray-400">
                Acesso restrito ao Administrador Master.
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-0">
            <div className="flex items-center justify-between mb-8 gap-4">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center">
                    <Globe className="h-7 w-7 mr-3 shrink-0" />
                    Site Público
                </h1>
                <Button
                    type="button"
                    onClick={() => navigate('/admin/dashboard')}
                    variant="outline"
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 text-sm shrink-0"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                </Button>
            </div>

            <Alert className="mb-6 border-cyan-500/30 bg-cyan-500/5">
                <Info className="h-4 w-4 text-cyan-300" />
                <AlertTitle className="text-cyan-200">Divulgação nas redes sociais</AlertTitle>
                <AlertDescription className="text-gray-300 text-sm">
                    Com o modo pré-lançamento ativo, visitantes que chegam pelo Instagram ou pelo domínio principal
                    veem uma página institucional em vez da vitrine de testes. Admin Master e gestores continuam
                    acessando o site completo quando logados.
                </AlertDescription>
            </Alert>

            <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10">
                <CardHeader>
                    <CardTitle className="text-white text-xl sm:text-2xl font-semibold flex items-center gap-2">
                        <Rocket className="h-6 w-6 text-yellow-500" />
                        Modo de exibição
                    </CardTitle>
                    <CardDescription className="text-gray-400 text-sm">
                        Controle o que visitantes anônimos veem ao acessar o site.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="flex items-center justify-between p-4 bg-black/70 rounded-xl border border-yellow-500/20 gap-4">
                        <div className="min-w-0">
                            <p className="text-white font-medium flex items-center gap-2">
                                {isPreview ? (
                                    <>
                                        <Eye className="h-4 w-4 text-cyan-400" />
                                        Pré-lançamento (página institucional)
                                    </>
                                ) : (
                                    <>
                                        <Globe className="h-4 w-4 text-green-400" />
                                        Site ao vivo (vitrine completa)
                                    </>
                                )}
                            </p>
                            <p className="text-gray-400 text-xs sm:text-sm mt-1">
                                {isPreview
                                    ? 'Visitantes veem texto sobre a EventFest, benefícios e formulário de contato. Eventos, checkout e cadastros ficam ocultos.'
                                    : 'Todos os visitantes acessam a landing com eventos, filtros e fluxo de compra normalmente.'}
                            </p>
                        </div>
                        <Switch
                            checked={isPreview}
                            onCheckedChange={(checked) => setMode(checked ? 'preview' : 'live')}
                            aria-label="Alternar modo pré-lançamento"
                            className="h-7 w-12 border-2 border-yellow-500/40 shadow-inner data-[state=checked]:bg-cyan-500 data-[state=checked]:border-cyan-400 data-[state=unchecked]:bg-zinc-600 data-[state=unchecked]:border-zinc-500 [&>span]:h-6 [&>span]:w-6 [&>span]:bg-white [&>span]:shadow-md data-[state=checked]:[&>span]:translate-x-5"
                        />
                    </div>

                    <div className="rounded-xl border border-yellow-500/15 bg-black/50 p-4 text-sm text-gray-400 space-y-2">
                        <p>
                            <span className="text-yellow-500 font-medium">Equipe interna:</span> contas Admin Master e
                            Gestores logados ignoram o pré-lançamento e podem testar a vitrine normalmente.
                        </p>
                        <p>
                            <span className="text-yellow-500 font-medium">SEO:</span> no modo pré-lançamento, a página
                            usa <code className="text-cyan-300">noindex</code> para evitar indexação de conteúdo
                            temporário.
                        </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3 pt-2">
                        <Button
                            type="button"
                            onClick={() => void handleSave()}
                            disabled={isSaving}
                            className="bg-yellow-500 text-black hover:bg-yellow-400"
                        >
                            {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            Salvar configuração
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => window.open('/', '_blank')}
                            className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                        >
                            <ExternalLink className="mr-2 h-4 w-4" />
                            Abrir site em nova aba
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default AdminPublicLaunchSettings;

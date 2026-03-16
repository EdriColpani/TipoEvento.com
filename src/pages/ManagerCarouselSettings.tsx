import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2, SlidersHorizontal, Clock, Maximize, MapPin, ListOrdered, CalendarDays } from 'lucide-react';
import { showSuccess, showError, showLoading, dismissToast } from '@/utils/toast';
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/hooks/use-profile';

interface CarouselSettingsState {
    rotation_time_seconds: number;
    max_banners_display: number;
    regional_distance_km: number;
    min_regional_banners: number;
    fallback_strategy: string;
    days_until_event_threshold: number;
}

const FALLBACK_STRATEGIES = [
    { value: 'latest_events', label: 'Eventos Mais Recentes' },
    { value: 'highest_rated', label: 'Eventos Mais Avaliados (Em Breve)' },
    { value: 'random', label: 'Aleatório' },
];

const ManagerCarouselSettings: React.FC = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState<string | null>(null);
    const { profile, isLoading: isLoadingProfile } = useProfile(userId || undefined);
    const [settings, setSettings] = useState<CarouselSettingsState | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        const fetchUserAndSettings = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                showError("Sessão expirada. Faça login novamente.");
                navigate('/manager/login');
                return;
            }
            setUserId(user.id);

            const { data, error } = await supabase
                .from('carousel_settings')
                .select('*')
                .limit(1)
                .single();

            if (error && error.code !== 'PGRST116') { // PGRST116 = No rows found
                console.error("Error fetching carousel settings:", error);
                showError("Erro ao carregar configurações do carrossel.");
            } else if (data) {
                setSettings({
                    rotation_time_seconds: data.rotation_time_seconds,
                    max_banners_display: data.max_banners_display,
                    regional_distance_km: data.regional_distance_km,
                    min_regional_banners: data.min_regional_banners,
                    fallback_strategy: data.fallback_strategy,
                    days_until_event_threshold: data.days_until_event_threshold,
                });
            } else {
                // Se não houver configurações, usa os defaults e insere
                const defaultSettings: CarouselSettingsState = {
                    rotation_time_seconds: 5,
                    max_banners_display: 5,
                    regional_distance_km: 100,
                    min_regional_banners: 3,
                    fallback_strategy: 'latest_events',
                    days_until_event_threshold: 30,
                };
                setSettings(defaultSettings);
                // Inserir os defaults no DB para que o admin possa editá-los
                await supabase.from('carousel_settings').insert([defaultSettings]);
            }
            setIsLoading(false);
        };
        fetchUserAndSettings();
    }, [navigate]);

    const handleInputChange = (key: keyof CarouselSettingsState, value: string | number) => {
        setSettings(prev => prev ? { ...prev, [key]: value } : null);
    };

    const handleSelectChange = (key: keyof CarouselSettingsState, value: string) => {
        setSettings(prev => prev ? { ...prev, [key]: value } : null);
    };

    const handleSave = async () => {
        if (!userId || !profile || Number(profile.tipo_usuario_id) !== 1 || !settings) {
            showError("Você não tem permissão para salvar estas configurações.");
            return;
        }

        setIsSaving(true);
        const toastId = showLoading("Salvando configurações do carrossel...");

        try {
            const { error } = await supabase
                .from('carousel_settings')
                .upsert(
                    { 
                        ...settings, 
                        updated_by: userId, 
                        updated_at: new Date().toISOString() 
                    },
                    { onConflict: 'id' } // Assume que sempre haverá um único registro com um ID
                );

            if (error) {
                throw error;
            }

            dismissToast(toastId);
            showSuccess("Configurações do carrossel salvas com sucesso!");
            navigate('/admin/dashboard'); // Ou para uma página de visualização do carrossel

        } catch (e: any) {
            dismissToast(toastId);
            console.error("Erro ao salvar configurações do carrossel:", e);
            showError(`Falha ao salvar configurações: ${e.message || 'Erro desconhecido'}`);
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading || isLoadingProfile || !userId || !settings) {
        return (
            <div className="max-w-4xl mx-auto px-4 sm:px-0 text-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando configurações do carrossel...</p>
            </div>
        );
    }

    if (Number(profile?.tipo_usuario_id) !== 1) {
        showError("Acesso negado. Você não tem permissão de Administrador Master para esta página.");
        navigate('/manager/dashboard');
        return null;
    }

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-0">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center">
                    <SlidersHorizontal className="h-7 w-7 mr-3" />
                    Configurações do Carrossel
                </h1>
                <Button 
                    onClick={() => navigate('/admin/dashboard')}
                    variant="outline"
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 text-sm"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                </Button>
            </div>

            <Card className="bg-black/80 backdrop-blur-sm border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10">
                <CardHeader>
                    <CardTitle className="text-white text-xl sm:text-2xl font-semibold">Ajustes de Exibição e Lógica</CardTitle>
                    <CardDescription className="text-gray-400 text-sm">
                        Configure como os banners de eventos são exibidos no carrossel da página inicial.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    
                    {/* Tempo de Rotação */}
                    <div>
                        <label htmlFor="rotation_time_seconds" className="block text-sm font-medium text-white mb-2 flex items-center">
                            <Clock className="h-4 w-4 mr-2 text-yellow-500" />
                            Tempo de Rotação (segundos)
                        </label>
                        <Input 
                            id="rotation_time_seconds" 
                            type="number"
                            value={settings.rotation_time_seconds} 
                            onChange={(e) => handleInputChange('rotation_time_seconds', Number(e.target.value))} 
                            placeholder="5"
                            className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500"
                            min={1}
                            disabled={isSaving}
                        />
                        <p className="text-xs text-gray-500 mt-1">Duração que cada banner fica visível antes de girar.</p>
                    </div>

                    {/* Máximo de Banners */}
                    <div>
                        <label htmlFor="max_banners_display" className="block text-sm font-medium text-white mb-2 flex items-center">
                            <Maximize className="h-4 w-4 mr-2 text-yellow-500" />
                            Máximo de Banners Exibidos
                        </label>
                        <Input 
                            id="max_banners_display" 
                            type="number"
                            value={settings.max_banners_display} 
                            onChange={(e) => handleInputChange('max_banners_display', Number(e.target.value))} 
                            placeholder="5"
                            className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500"
                            min={1}
                            max={10}
                            disabled={isSaving}
                        />
                        <p className="text-xs text-gray-500 mt-1">Número máximo de eventos que aparecerão no carrossel.</p>
                    </div>

                    {/* Distância Regional */}
                    <div>
                        <label htmlFor="regional_distance_km" className="block text-sm font-medium text-white mb-2 flex items-center">
                            <MapPin className="h-4 w-4 mr-2 text-yellow-500" />
                            Distância Regional (KM)
                        </label>
                        <Input 
                            id="regional_distance_km" 
                            type="number"
                            value={settings.regional_distance_km} 
                            onChange={(e) => handleInputChange('regional_distance_km', Number(e.target.value))} 
                            placeholder="100"
                            className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500"
                            min={0}
                            disabled={isSaving}
                        />
                        <p className="text-xs text-gray-500 mt-1">Raio em KM para priorizar eventos próximos à localização do usuário.</p>
                    </div>

                    {/* Mínimo de Banners Regionais */}
                    <div>
                        <label htmlFor="min_regional_banners" className="block text-sm font-medium text-white mb-2 flex items-center">
                            <ListOrdered className="h-4 w-4 mr-2 text-yellow-500" />
                            Mínimo de Banners Regionais
                        </label>
                        <Input 
                            id="min_regional_banners" 
                            type="number"
                            value={settings.min_regional_banners} 
                            onChange={(e) => handleInputChange('min_regional_banners', Number(e.target.value))} 
                            placeholder="3"
                            className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500"
                            min={0}
                            max={settings.max_banners_display}
                            disabled={isSaving}
                        />
                        <p className="text-xs text-gray-500 mt-1">Número mínimo de banners regionais a serem exibidos, se disponíveis.</p>
                    </div>

                    {/* Estratégia de Fallback */}
                    <div>
                        <label htmlFor="fallback_strategy" className="block text-sm font-medium text-white mb-2 flex items-center">
                            <SlidersHorizontal className="h-4 w-4 mr-2 text-yellow-500" />
                            Estratégia de Fallback
                        </label>
                        <Select 
                            onValueChange={(value) => handleSelectChange('fallback_strategy', value)} 
                            value={settings.fallback_strategy}
                            disabled={isSaving}
                        >
                            <SelectTrigger className="w-full bg-black/60 border-yellow-500/30 text-white focus:ring-yellow-500">
                                <SelectValue placeholder="Selecione a estratégia" />
                            </SelectTrigger>
                            <SelectContent className="bg-black border-yellow-500/30 text-white">
                                {FALLBACK_STRATEGIES.map(strategy => (
                                    <SelectItem key={strategy.value} value={strategy.value} className="hover:bg-yellow-500/10 cursor-pointer">
                                        {strategy.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-gray-500 mt-1">Como preencher o carrossel se não houver banners regionais suficientes.</p>
                    </div>
                    
                    {/* Dias até o Evento (Threshold) */}
                    <div>
                        <label htmlFor="days_until_event_threshold" className="block text-sm font-medium text-white mb-2 flex items-center">
                            <CalendarDays className="h-4 w-4 mr-2 text-yellow-500" />
                            Priorizar Eventos Próximos (dias)
                        </label>
                        <Input 
                            id="days_until_event_threshold" 
                            type="number"
                            value={settings.days_until_event_threshold} 
                            onChange={(e) => handleInputChange('days_until_event_threshold', Number(e.target.value))} 
                            placeholder="30"
                            className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500"
                            min={0}
                            disabled={isSaving}
                        />
                        <p className="text-xs text-gray-500 mt-1">Eventos que ocorrem dentro deste número de dias serão priorizados.</p>
                    </div>

                    <div className="pt-4 flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4">
                        <Button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="flex-1 bg-yellow-500 text-black hover:bg-yellow-600 py-3 text-lg font-semibold transition-all duration-300 cursor-pointer disabled:opacity-50"
                        >
                            {isSaving ? (
                                <div className="flex items-center justify-center">
                                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                                    Salvando...
                                </div>
                            ) : (
                                <>
                                    <i className="fas fa-save mr-2"></i>
                                    Salvar Configurações
                                </>
                            )}
                        </Button>
                        <Button
                            onClick={() => navigate('/admin/dashboard')}
                            variant="outline"
                            className="flex-1 bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 py-3 text-lg font-semibold transition-all duration-300 cursor-pointer"
                            disabled={isSaving}
                        >
                            <ArrowLeft className="mr-2 h-5 w-5" />
                            Voltar para o Dashboard
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default ManagerCarouselSettings;
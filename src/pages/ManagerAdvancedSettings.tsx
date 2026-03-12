import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Settings, ArrowLeft, Loader2, Zap, Key, Database } from 'lucide-react';
import { showSuccess, showError, showLoading, dismissToast } from '@/utils/toast';

interface AdvancedSettingsState {
    developmentMode: boolean;
    apiIntegrationEnabled: boolean;
    apiKey: string;
    autoArchiveEvents: boolean;
}

const DEFAULT_ADVANCED_SETTINGS: AdvancedSettingsState = {
    developmentMode: false,
    apiIntegrationEnabled: false,
    apiKey: '********************', // Mocked API Key
    autoArchiveEvents: true,
};

const ManagerAdvancedSettings: React.FC = () => {
    const navigate = useNavigate();
    // Página já está sob AdminMasterRouteGuard: apenas Administrador Global acessa
    const [settings, setSettings] = useState<AdvancedSettingsState>(DEFAULT_ADVANCED_SETTINGS);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    // Simulação de carregamento de dados
    useEffect(() => {
        // Em um cenário real, buscaríamos essas configurações do DB (ex: manager_advanced_settings)
        setTimeout(() => {
            setSettings(DEFAULT_ADVANCED_SETTINGS);
            setIsLoading(false);
        }, 800);
    }, []);

    const handleSwitchChange = (key: keyof AdvancedSettingsState, checked: boolean) => {
        setSettings(prev => ({ ...prev, [key]: checked }));
    };

    const handleInputChange = (key: keyof AdvancedSettingsState, value: string) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    const handleSave = async () => {
        setIsSaving(true);
        const toastId = showLoading("Salvando configurações avançadas...");

        // Simulação de salvamento no DB
        try {
            await new Promise(resolve => setTimeout(resolve, 1500)); 
            
            // Lógica de salvamento real iria aqui (ex: Supabase update)

            dismissToast(toastId);
            showSuccess("Configurações avançadas salvas com sucesso!");
            navigate('/manager/settings');

        } catch (e: any) {
            dismissToast(toastId);
            console.error("Save Error:", e);
            showError(`Falha ao salvar configurações: ${e.message || 'Erro desconhecido'}`);
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return (
            <div className="max-w-4xl mx-auto px-4 sm:px-0 text-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando configurações avançadas...</p>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-0">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center">
                    <Settings className="h-7 w-7 mr-3" />
                    Configurações Avançadas
                </h1>
                <Button 
                    onClick={() => navigate('/manager/settings')}
                    variant="outline"
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 text-sm"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                </Button>
            </div>

            <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10">
                <CardHeader>
                    <CardTitle className="text-white text-xl sm:text-2xl font-semibold">Ajustes de Sistema e Segurança</CardTitle>
                    <CardDescription className="text-gray-400 text-sm">
                        Configurações que afetam o comportamento geral da sua conta PRO.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    
                    {/* Modo de Desenvolvimento */}
                    <div className="space-y-4 pt-4 border-t border-yellow-500/10">
                        <h3 className="text-lg font-semibold text-white flex items-center">
                            <Zap className="mr-2 h-5 w-5 text-yellow-500" />
                            Sistema
                        </h3>
                        
                        <div className="flex items-center justify-between p-4 bg-black/70 rounded-xl border border-yellow-500/20">
                            <div>
                                <p className="text-white font-medium">Modo de Desenvolvimento</p>
                                <p className="text-gray-400 text-xs">Ativa recursos de teste e desativa otimizações de produção. Use com cautela.</p>
                            </div>
                            <Switch 
                                checked={settings.developmentMode} 
                                onCheckedChange={(checked) => handleSwitchChange('developmentMode', checked)}
                                className="data-[state=checked]:bg-yellow-500 data-[state=unchecked]:bg-gray-700"
                                disabled={isSaving}
                            />
                        </div>

                        <div className="flex items-center justify-between p-4 bg-black/70 rounded-xl border border-yellow-500/20">
                            <div>
                                <p className="text-white font-medium">Arquivamento Automático de Eventos</p>
                                <p className="text-gray-400 text-xs">Eventos finalizados são movidos automaticamente para o arquivo após 7 dias.</p>
                            </div>
                            <Switch 
                                checked={settings.autoArchiveEvents} 
                                onCheckedChange={(checked) => handleSwitchChange('autoArchiveEvents', checked)}
                                className="data-[state=checked]:bg-yellow-500 data-[state=unchecked]:bg-gray-700"
                                disabled={isSaving}
                            />
                        </div>
                    </div>

                    {/* Integrações e API */}
                    <div className="space-y-4 pt-4 border-t border-yellow-500/10">
                        <h3 className="text-lg font-semibold text-white flex items-center">
                            <Key className="mr-2 h-5 w-5 text-yellow-500" />
                            Integração de API
                        </h3>
                        
                        <div className="flex items-center justify-between p-4 bg-black/70 rounded-xl border border-yellow-500/20">
                            <div>
                                <p className="text-white font-medium">Habilitar Integração Externa</p>
                                <p className="text-gray-400 text-xs">Permite que sistemas externos acessem seus dados de eventos via API.</p>
                            </div>
                            <Switch 
                                checked={settings.apiIntegrationEnabled} 
                                onCheckedChange={(checked) => handleSwitchChange('apiIntegrationEnabled', checked)}
                                className="data-[state=checked]:bg-yellow-500 data-[state=unchecked]:bg-gray-700"
                                disabled={isSaving}
                            />
                        </div>

                        <div>
                            <label htmlFor="apiKey" className="block text-sm font-medium text-white mb-2">Chave de API Secreta</label>
                            <Input 
                                id="apiKey" 
                                type="text"
                                value={settings.apiKey} 
                                onChange={(e) => handleInputChange('apiKey', e.target.value)} 
                                placeholder="********************"
                                className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500"
                                disabled={isSaving || !settings.apiIntegrationEnabled}
                            />
                            <p className="text-xs text-gray-500 mt-1">Mantenha esta chave segura. Clique para gerar uma nova.</p>
                        </div>
                    </div>

                    {/* Backup do Banco (somente Administrador Global - página já protegida) */}
                    <div className="space-y-4 pt-4 border-t border-yellow-500/10">
                        <h3 className="text-lg font-semibold text-white flex items-center">
                            <Database className="mr-2 h-5 w-5 text-yellow-500" />
                            Backup do Banco
                        </h3>
                        <div
                            onClick={() => navigate('/manager/settings/backup-database')}
                            className="flex items-center justify-between p-4 bg-black/70 rounded-xl border border-yellow-500/20 cursor-pointer hover:bg-yellow-500/10 transition-colors"
                        >
                            <div>
                                <p className="text-white font-medium">Realizar backup via SQL</p>
                                <p className="text-gray-400 text-xs">Gera arquivo SQL com data/hora contendo esquema e dados do banco. Apenas Administrador Global.</p>
                            </div>
                            <span className="text-yellow-500">Ir →</span>
                        </div>
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
                            onClick={() => navigate('/manager/settings')}
                            variant="outline"
                            className="flex-1 bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 py-3 text-lg font-semibold transition-all duration-300 cursor-pointer"
                            disabled={isSaving}
                        >
                            <ArrowLeft className="mr-2 h-5 w-5" />
                            Voltar para Configurações
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default ManagerAdvancedSettings;
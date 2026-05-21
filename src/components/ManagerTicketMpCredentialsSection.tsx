import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Lock, Key, Link2, Unlink } from 'lucide-react';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import {
    fetchManagerPaymentSettingsMasked,
    saveManagerPaymentSettings,
    startMpOAuthConnect,
    disconnectMpOAuth,
} from '@/utils/payment-settings-api';

interface PaymentSettingsState {
    gatewayName: string;
    apiKey: string;
    apiToken: string;
}

const DEFAULT_SETTINGS: PaymentSettingsState = {
    gatewayName: 'Mercado Pago',
    apiKey: '',
    apiToken: '',
};

function maskPlaceholder(last4: string | null): string {
    return last4 ? `••••••••••••${last4}` : '';
}

type ManagerTicketMpCredentialsSectionProps = {
    companyId: string;
};

const ManagerTicketMpCredentialsSection: React.FC<ManagerTicketMpCredentialsSectionProps> = ({
    companyId,
}) => {
    const [searchParams, setSearchParams] = useSearchParams();
    const [settings, setSettings] = useState<PaymentSettingsState>(DEFAULT_SETTINGS);
    const [configured, setConfigured] = useState(false);
    const [oauthConnected, setOauthConnected] = useState(false);
    const [collectorId, setCollectorId] = useState<string | null>(null);
    const [connectionSource, setConnectionSource] = useState<string>('manual');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [showManual, setShowManual] = useState(false);

    const loadSettings = useCallback(async () => {
        const masked = await fetchManagerPaymentSettingsMasked();
        setConfigured(masked.configured);
        setOauthConnected(masked.oauth_connected);
        setCollectorId(masked.mp_collector_id);
        setConnectionSource(masked.connection_source);
        setSettings({
            gatewayName: masked.gateway_name || DEFAULT_SETTINGS.gatewayName,
            apiKey: maskPlaceholder(masked.api_key_last4),
            apiToken: maskPlaceholder(masked.api_token_last4),
        });
        setShowManual(!masked.oauth_connected && masked.configured);
    }, []);

    useEffect(() => {
        (async () => {
            try {
                await loadSettings();
            } catch (e) {
                console.error(e);
                showError('Erro ao carregar credenciais de pagamento de ingressos.');
            } finally {
                setLoading(false);
            }
        })();
    }, [loadSettings]);

    useEffect(() => {
        const oauthResult = searchParams.get('mp_oauth');
        if (!oauthResult) return;

        if (oauthResult === 'success') {
            const col = searchParams.get('mp_collector');
            showSuccess(
                col
                    ? `Conta Mercado Pago conectada (collector ${col}).`
                    : 'Conta Mercado Pago conectada com sucesso.',
            );
            loadSettings().catch(console.error);
        } else {
            const msg = searchParams.get('mp_message') ?? 'erro';
            showError(`Não foi possível conectar ao Mercado Pago (${msg}).`);
        }

        const next = new URLSearchParams(searchParams);
        next.delete('mp_oauth');
        next.delete('mp_message');
        next.delete('mp_collector');
        setSearchParams(next, { replace: true });
    }, [searchParams, setSearchParams, loadSettings]);

    const handleConnectOAuth = async () => {
        setConnecting(true);
        try {
            const url = await startMpOAuthConnect();
            window.location.href = url;
        } catch (e) {
            showError(e instanceof Error ? e.message : 'Falha ao abrir Mercado Pago.');
            setConnecting(false);
        }
    };

    const handleDisconnect = async () => {
        const toastId = showLoading('Desconectando...');
        try {
            await disconnectMpOAuth();
            dismissToast(toastId);
            showSuccess('Conta Mercado Pago desconectada.');
            await loadSettings();
        } catch (e) {
            dismissToast(toastId);
            showError(e instanceof Error ? e.message : 'Falha ao desconectar.');
        }
    };

    const handleSaveManual = async () => {
        setSaving(true);
        const toastId = showLoading('Salvando credenciais de ingressos...');
        try {
            await saveManagerPaymentSettings({
                companyId,
                gatewayName: settings.gatewayName,
                apiKey: settings.apiKey.startsWith('••••') ? undefined : settings.apiKey,
                apiToken: settings.apiToken.startsWith('••••') ? undefined : settings.apiToken,
            });
            dismissToast(toastId);
            showSuccess('Credenciais salvas (modo manual).');
            await loadSettings();
        } catch (e) {
            dismissToast(toastId);
            showError(e instanceof Error ? e.message : 'Falha ao salvar.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500" />
            </div>
        );
    }

    return (
        <Card className="bg-black/80 border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10">
            <CardHeader>
                <CardTitle className="text-white text-xl font-semibold">Mercado Pago — ingressos</CardTitle>
                <CardDescription className="text-gray-400 text-sm">
                    Conta da sua empresa para receber ingressos. Comissão EventFest retida no pagamento (marketplace).
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
                <div className="bg-yellow-500/10 border border-yellow-500/40 text-yellow-100 p-3 rounded-lg text-sm">
                    Recomendado: use <strong>Conectar com Mercado Pago</strong> (OAuth). O sistema grava o token e o{' '}
                    <strong>collector_id</strong> automaticamente para split no ato da compra.
                </div>

                {oauthConnected && (
                    <div className="bg-green-500/15 border border-green-500/40 rounded-lg p-4 text-sm text-green-300">
                        <p className="font-medium text-green-400 mb-1">Conta conectada via OAuth</p>
                        {collectorId && <p>Collector ID: <code className="text-white">{collectorId}</code></p>}
                        <p className="text-gray-400 text-xs mt-1">Token: ••••{settings.apiToken.slice(-4) || '****'}</p>
                    </div>
                )}

                <div className="flex flex-wrap gap-3">
                    <Button
                        type="button"
                        onClick={handleConnectOAuth}
                        disabled={connecting}
                        className="bg-yellow-500 text-black hover:bg-yellow-600"
                    >
                        {connecting ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                            <Link2 className="h-4 w-4 mr-2" />
                        )}
                        {oauthConnected ? 'Reconectar Mercado Pago' : 'Conectar com Mercado Pago'}
                    </Button>
                    {(oauthConnected || configured) && (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleDisconnect}
                            className="border-yellow-500/40 text-yellow-500 hover:bg-yellow-500/10"
                        >
                            <Unlink className="h-4 w-4 mr-2" />
                            Desconectar
                        </Button>
                    )}
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setShowManual((v) => !v)}
                        className="text-gray-400 hover:text-white"
                    >
                        {showManual ? 'Ocultar token manual' : 'Usar token manual (avançado)'}
                    </Button>
                </div>

                {showManual && (
                    <div className="space-y-4 pt-2 border-t border-yellow-500/20">
                        <p className="text-xs text-gray-500">
                            Modo manual ({connectionSource}). Use só se OAuth não estiver disponível.
                        </p>
                        <div>
                            <label className="block text-sm text-white mb-2">Nome do gateway</label>
                            <Input
                                value={settings.gatewayName}
                                onChange={(e) => setSettings((s) => ({ ...s, gatewayName: e.target.value }))}
                                className="bg-black/60 border-yellow-500/30 text-white"
                                disabled={saving}
                            />
                        </div>
                        <div>
                            <label className="text-sm text-white flex items-center gap-2 mb-2">
                                <Key className="h-4 w-4 text-yellow-500" />
                                Public Key (opcional)
                            </label>
                            <Input
                                value={settings.apiKey}
                                onChange={(e) => setSettings((s) => ({ ...s, apiKey: e.target.value }))}
                                className="bg-black/60 border-yellow-500/30 text-white"
                                disabled={saving}
                            />
                        </div>
                        <div>
                            <label className="text-sm text-white flex items-center gap-2 mb-2">
                                <Lock className="h-4 w-4 text-yellow-500" />
                                Access Token
                            </label>
                            <Input
                                type="password"
                                value={settings.apiToken}
                                onChange={(e) => setSettings((s) => ({ ...s, apiToken: e.target.value }))}
                                className="bg-black/60 border-yellow-500/30 text-white"
                                disabled={saving}
                            />
                        </div>
                        <Button
                            type="button"
                            onClick={handleSaveManual}
                            disabled={saving}
                            variant="outline"
                            className="border-yellow-500/40 text-yellow-500"
                        >
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar token manual'}
                        </Button>
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

export default ManagerTicketMpCredentialsSection;

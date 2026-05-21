import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Lock, Key } from 'lucide-react';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import {
    fetchPlatformMpSettingsMasked,
    savePlatformMpSettings,
} from '@/utils/payment-settings-api';

function maskPlaceholder(last4: string | null): string {
    return last4 ? `••••••••••••${last4}` : '';
}

type PlatformMpCredentialsSectionProps = {
    /** Estilo alinhado à página Configurações Avançadas (admin) */
    variant?: 'default' | 'advanced';
};

const PlatformMpCredentialsSection: React.FC<PlatformMpCredentialsSectionProps> = ({
    variant = 'default',
}) => {
    const isAdvanced = variant === 'advanced';
    const borderClass = isAdvanced ? 'border-yellow-500/30' : 'border-cyan-500/30';
    const titleClass = isAdvanced ? 'text-yellow-500' : 'text-cyan-400';
    const iconClass = isAdvanced ? 'text-yellow-500' : 'text-cyan-400';
    const inputClass = isAdvanced
        ? 'bg-black/60 border-yellow-500/30 text-white'
        : 'bg-black/60 border-cyan-500/30 text-white';
    const btnClass = isAdvanced
        ? 'bg-yellow-500 text-black hover:bg-yellow-600'
        : 'bg-cyan-400 text-black hover:bg-cyan-300';

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [configured, setConfigured] = useState(false);
    const [publicKey, setPublicKey] = useState('');
    const [accessToken, setAccessToken] = useState('');

    useEffect(() => {
        (async () => {
            try {
                const masked = await fetchPlatformMpSettingsMasked();
                setConfigured(masked.configured);
                setPublicKey(maskPlaceholder(masked.public_key_last4));
                setAccessToken(maskPlaceholder(masked.token_last4));
            } catch (e) {
                console.error(e);
                showError('Erro ao carregar credenciais Mercado Pago da plataforma.');
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const handleSave = async () => {
        setSaving(true);
        const toastId = showLoading('Salvando credenciais da plataforma...');
        try {
            await savePlatformMpSettings({
                publicKey: publicKey.startsWith('••••') ? undefined : publicKey,
                accessToken: accessToken.startsWith('••••') ? undefined : accessToken,
            });
            dismissToast(toastId);
            showSuccess('Credenciais da plataforma salvas (criptografadas).');
            const masked = await fetchPlatformMpSettingsMasked();
            setConfigured(masked.configured);
            setPublicKey(maskPlaceholder(masked.public_key_last4));
            setAccessToken(maskPlaceholder(masked.token_last4));
        } catch (e) {
            dismissToast(toastId);
            showError(e instanceof Error ? e.message : 'Falha ao salvar.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center py-8">
                <Loader2 className={`h-8 w-8 animate-spin ${isAdvanced ? 'text-yellow-500' : 'text-cyan-400'}`} />
            </div>
        );
    }

    return (
        <Card
            className={`bg-black/70 border ${borderClass} rounded-xl ${isAdvanced ? 'mb-0 shadow-none' : 'rounded-2xl mb-6 shadow-2xl shadow-cyan-500/10'}`}
        >
            <CardHeader className={isAdvanced ? 'pb-2' : undefined}>
                <CardTitle className={`${titleClass} text-lg`}>Mercado Pago — conta EventFest</CardTitle>
                <CardDescription className="text-gray-400 text-sm">
                    Somente Admin Master. Mensalidades, assinaturas e cobranças EventFest — separado das credenciais
                    de ingressos (Perfil da Empresa → aba Ingressos MP, visível só ao gestor).
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="bg-amber-500/10 border border-amber-500/40 text-amber-200 p-3 rounded-lg text-sm flex gap-2">
                    <Lock className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                        Tokens são armazenados criptografados. Você também pode definir{' '}
                        <code className="text-amber-100">PLATFORM_MP_ACCESS_TOKEN</code> no Supabase (prioridade sobre o banco).
                    </span>
                </div>
                {configured && (
                    <p className="text-green-400 text-sm">Conta da plataforma configurada.</p>
                )}
                <div>
                    <label className="text-sm text-gray-300 flex items-center gap-2 mb-2">
                        <Key className={`h-4 w-4 ${iconClass}`} />
                        Public Key (opcional)
                    </label>
                    <Input
                        value={publicKey}
                        onChange={(e) => setPublicKey(e.target.value)}
                        placeholder="APP_USR-..."
                        className={inputClass}
                        disabled={saving}
                    />
                </div>
                <div>
                    <label className="text-sm text-gray-300 flex items-center gap-2 mb-2">
                        <Lock className={`h-4 w-4 ${iconClass}`} />
                        Access Token (obrigatório)
                    </label>
                    <Input
                        value={accessToken}
                        onChange={(e) => setAccessToken(e.target.value)}
                        placeholder="APP_USR-..."
                        className={inputClass}
                        disabled={saving}
                    />
                    <p className="text-xs text-gray-500 mt-1">Deixe mascarado para manter o token atual.</p>
                </div>
                <Button type="button" onClick={handleSave} disabled={saving} className={btnClass}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar credenciais da plataforma'}
                </Button>
            </CardContent>
        </Card>
    );
};

export default PlatformMpCredentialsSection;

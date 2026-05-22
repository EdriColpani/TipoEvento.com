import { supabase } from '@/integrations/supabase/client';
import { parseEdgeFunctionError } from '@/utils/edge-function-error';

export interface MaskedPaymentSettings {
    configured: boolean;
    oauth_connected: boolean;
    gateway_name: string;
    api_key_last4: string | null;
    api_token_last4: string | null;
    mp_collector_id: string | null;
    connection_source: 'manual' | 'oauth' | string;
    oauth_connected_at?: string | null;
    token_expires_at?: string | null;
    updated_at?: string | null;
}

export async function fetchManagerPaymentSettingsMasked(): Promise<MaskedPaymentSettings> {
    const { data, error } = await supabase.rpc('get_payment_settings_masked');
    if (error) throw new Error(error.message);
    const row = data as Record<string, unknown> | null;
    return {
        configured: Boolean(row?.configured),
        oauth_connected: Boolean(row?.oauth_connected),
        gateway_name: String(row?.gateway_name ?? 'Mercado Pago'),
        api_key_last4: (row?.api_key_last4 as string) ?? null,
        api_token_last4: (row?.api_token_last4 as string) ?? null,
        mp_collector_id: (row?.mp_collector_id as string) ?? null,
        connection_source: String(row?.connection_source ?? 'manual'),
        oauth_connected_at: (row?.oauth_connected_at as string) ?? null,
        token_expires_at: (row?.token_expires_at as string) ?? null,
        updated_at: (row?.updated_at as string) ?? null,
    };
}

export async function startMpOAuthConnect(): Promise<string> {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) throw new Error('Sessão expirada.');

    const { data, error } = await supabase.functions.invoke('mp-oauth-start', {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (error) throw new Error(await parseEdgeFunctionError(error, data));
    const payload = data as { authorizationUrl?: string; error?: string };
    if (payload?.error) throw new Error(payload.error);
    if (!payload?.authorizationUrl) throw new Error('URL de autorização não retornada.');
    return payload.authorizationUrl;
}

export async function disconnectMpOAuth(): Promise<void> {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) throw new Error('Sessão expirada.');

    const { data, error } = await supabase.functions.invoke('mp-oauth-disconnect', {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (error) throw new Error(await parseEdgeFunctionError(error, data));
    const payload = data as { error?: string };
    if (payload?.error) throw new Error(payload.error);
}

export async function saveManagerPaymentSettings(params: {
    companyId?: string;
    gatewayName: string;
    apiKey?: string;
    apiToken?: string;
}): Promise<void> {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) throw new Error('Sessão expirada.');

    const { data, error } = await supabase.functions.invoke('save-manager-payment-settings', {
        body: {
            companyId: params.companyId,
            gatewayName: params.gatewayName,
            apiKey: params.apiKey ?? '',
            apiToken: params.apiToken ?? '',
        },
        headers: { Authorization: `Bearer ${token}` },
    });

    if (error) throw new Error(error.message || 'Erro ao salvar credenciais.');
    const payload = data as { error?: string };
    if (payload?.error) throw new Error(payload.error);
}

export interface MaskedPlatformMpSettings {
    configured: boolean;
    public_key_last4: string | null;
    token_last4: string | null;
    updated_at?: string | null;
}

export async function fetchPlatformMpSettingsMasked(): Promise<MaskedPlatformMpSettings> {
    const { data, error } = await supabase.rpc('get_platform_mp_settings_masked');
    if (error) throw new Error(error.message);
    const row = data as Record<string, unknown> | null;
    return {
        configured: Boolean(row?.configured),
        public_key_last4: (row?.public_key_last4 as string) ?? null,
        token_last4: (row?.token_last4 as string) ?? null,
        updated_at: (row?.updated_at as string) ?? null,
    };
}

export async function savePlatformMpSettings(params: {
    publicKey?: string;
    accessToken?: string;
}): Promise<void> {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) throw new Error('Sessão expirada.');

    const { data, error } = await supabase.functions.invoke('save-platform-mp-settings', {
        body: {
            publicKey: params.publicKey ?? '',
            accessToken: params.accessToken ?? '',
        },
        headers: { Authorization: `Bearer ${token}` },
    });

    if (error) throw new Error(error.message || 'Erro ao salvar credenciais da plataforma.');
    const payload = data as { error?: string };
    if (payload?.error) throw new Error(payload.error);
}

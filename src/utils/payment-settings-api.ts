import { getAuthAccessToken } from '@/utils/auth-session-cache';
import { invokeEdgeFunctionRest } from '@/utils/edge-function-rest';
import { callRpcRest } from '@/utils/supabase-rest-rpc';

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
    const row = await callRpcRest<Record<string, unknown>>('get_payment_settings_masked', {}, 10_000);
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
    const payload = await invokeEdgeFunctionRest<{ authorizationUrl?: string; error?: string }>(
        'mp-oauth-start',
        {},
        { timeoutMs: 20_000 },
    );
    if (payload?.error) throw new Error(payload.error);
    if (!payload?.authorizationUrl) throw new Error('URL de autorização não retornada.');
    return payload.authorizationUrl;
}

export async function disconnectMpOAuth(): Promise<void> {
    const payload = await invokeEdgeFunctionRest<{ error?: string }>(
        'mp-oauth-disconnect',
        {},
        { timeoutMs: 15_000 },
    );
    if (payload?.error) throw new Error(payload.error);
}

export async function saveManagerPaymentSettings(params: {
    companyId?: string;
    gatewayName: string;
    apiKey?: string;
    apiToken?: string;
}): Promise<void> {
    const token = getAuthAccessToken();
    if (!token) throw new Error('Sessão expirada.');

    await invokeEdgeFunctionRest(
        'save-manager-payment-settings',
        {
            companyId: params.companyId,
            gatewayName: params.gatewayName,
            apiKey: params.apiKey ?? '',
            apiToken: params.apiToken ?? '',
        },
        { timeoutMs: 20_000 },
    );
}

export interface MaskedPlatformMpSettings {
    configured: boolean;
    public_key_last4: string | null;
    token_last4: string | null;
    updated_at?: string | null;
}

export async function fetchPlatformMpSettingsMasked(): Promise<MaskedPlatformMpSettings> {
    const row = await callRpcRest<Record<string, unknown>>('get_platform_mp_settings_masked', {}, 10_000);
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
    const token = getAuthAccessToken();
    if (!token) throw new Error('Sessão expirada.');

    await invokeEdgeFunctionRest(
        'save-platform-mp-settings',
        {
            publicKey: params.publicKey ?? '',
            accessToken: params.accessToken ?? '',
        },
        { timeoutMs: 20_000 },
    );
}

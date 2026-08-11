import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { eventListingSubscriptionBlocks } from '../_shared/listing-subscription-guard.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-api-key',
  'Content-Type': 'application/json',
};

const supabaseService = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

async function hashApiKey(apiKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function parseDeliveryToken(raw: unknown): string | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const match = text.match(/EFDEL\.[A-Za-z0-9]+/i);
  if (match?.[0]) return match[0];
  if (/^[A-Za-z0-9._-]+$/i.test(text) && text.toUpperCase().startsWith('EFDEL')) {
    return text;
  }
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = req.headers.get('x-api-key')?.trim() ?? '';
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'API Key não fornecida. Envie no header x-api-key.',
        }),
        { status: 401, headers: corsHeaders },
      );
    }

    const apiKeyHash = await hashApiKey(apiKey);
    const { data: apiKeyData, error: apiKeyError } = await supabaseService
      .from('validation_api_keys')
      .select('id, name, event_id, is_active, expires_at, key_purpose')
      .eq('api_key_hash', apiKeyHash)
      .maybeSingle();

    if (apiKeyError || !apiKeyData) {
      return new Response(
        JSON.stringify({ success: false, error: 'API Key inválida ou não encontrada.' }),
        { status: 401, headers: corsHeaders },
      );
    }

    if ((apiKeyData as { key_purpose?: string }).key_purpose !== 'consumption_delivery') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Esta chave é de portaria e não entrega pedidos de consumo.',
          error_code: 'wrong_key_purpose',
        }),
        { status: 403, headers: corsHeaders },
      );
    }

    if (!apiKeyData.is_active) {
      return new Response(
        JSON.stringify({ success: false, error: 'API Key desativada.' }),
        { status: 403, headers: corsHeaders },
      );
    }

    if (apiKeyData.expires_at) {
      const expiresAt = new Date(apiKeyData.expires_at as string);
      if (expiresAt < new Date()) {
        return new Response(
          JSON.stringify({ success: false, error: 'API Key expirada.' }),
          { status: 403, headers: corsHeaders },
        );
      }
    }

    const listingBlock = await eventListingSubscriptionBlocks(
      supabaseService,
      apiKeyData.event_id as string | null,
    );
    if (listingBlock.blocked) {
      return new Response(
        JSON.stringify({
          success: false,
          error: listingBlock.message,
          error_code: 'subscription_lapsed',
        }),
        { status: 403, headers: corsHeaders },
      );
    }

    const eventId = (apiKeyData.event_id as string | null) ?? null;
    if (!eventId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Chave de consumo sem evento vinculado.',
        }),
        { status: 400, headers: corsHeaders },
      );
    }

    const { data: eventRow, error: eventError } = await supabaseService
      .from('events')
      .select('id, title, company_id')
      .eq('id', eventId)
      .maybeSingle();

    if (eventError || !eventRow?.company_id) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Não foi possível resolver a empresa do evento da chave.',
        }),
        { status: 400, headers: corsHeaders },
      );
    }

    const companyId = eventRow.company_id as string;
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = String(body.action ?? 'preview').trim().toLowerCase();
    const deliveryToken = parseDeliveryToken(body.delivery_token ?? body.token ?? body.qr);

    if (!deliveryToken) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'QR de pedido inválido. Use o código EFDEL do cliente.',
          error_code: 'qr_invalid',
        }),
        { status: 400, headers: corsHeaders },
      );
    }

    await supabaseService
      .from('validation_api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', apiKeyData.id);

    if (action === 'preview') {
      const { data, error } = await supabaseService.rpc(
        'preview_consumption_delivery_for_validator',
        {
          p_company_id: companyId,
          p_delivery_token: deliveryToken,
          p_event_id: eventId,
        },
      );

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 400, headers: corsHeaders },
        );
      }

      const preview = data as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          success: true,
          action: 'preview',
          delivery_token: deliveryToken,
          validated_by: apiKeyData.name,
          event_title: eventRow.title ?? preview.event_title ?? null,
          ...preview,
        }),
        { status: 200, headers: corsHeaders },
      );
    }

    if (action === 'complete' || action === 'finalize') {
      const { data, error } = await supabaseService.rpc(
        'complete_consumption_delivery_for_validator',
        {
          p_company_id: companyId,
          p_delivery_token: deliveryToken,
          p_operator_label: apiKeyData.name,
          p_event_id: eventId,
        },
      );

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 400, headers: corsHeaders },
        );
      }

      const result = data as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          success: true,
          action: 'complete',
          delivery_token: deliveryToken,
          validated_by: apiKeyData.name,
          event_title: eventRow.title ?? result.event_title ?? null,
          ...result,
        }),
        { status: 200, headers: corsHeaders },
      );
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: 'Ação inválida. Use "preview" ou "complete".',
      }),
      { status: 400, headers: corsHeaders },
    );
  } catch (err: unknown) {
    console.error('[validate-consumption-delivery]', err);
    const message = err instanceof Error ? err.message : 'Erro interno.';
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});

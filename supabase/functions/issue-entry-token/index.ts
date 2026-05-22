import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { signEntryToken } from '../_shared/entry-qr-token.ts';
import { userOwnsAnalyticsEntry } from '../_shared/entry-qr-ownership.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const supabaseService = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Não autorizado.' }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const supabaseAnon = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userError } = await supabaseAnon.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Sessão inválida.' }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const body = await req.json().catch(() => ({}));
    const analyticsId = typeof body.analyticsId === 'string' ? body.analyticsId.trim() : '';
    if (!analyticsId) {
      return new Response(JSON.stringify({ error: 'analyticsId é obrigatório.' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const { data: wa, error: waError } = await supabaseService
      .from('wristband_analytics')
      .select('id, status, event_type, client_user_id, entry_token_version, wristband_id')
      .eq('id', analyticsId)
      .maybeSingle();

    if (waError) throw waError;
    if (!wa) {
      return new Response(JSON.stringify({ error: 'Ingresso não encontrado.' }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    if (wa.event_type !== 'purchase') {
      return new Response(JSON.stringify({ error: 'QR dinâmico disponível apenas para ingressos de compra.' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    if (wa.status === 'used') {
      return new Response(JSON.stringify({ error: 'Ingresso já utilizado na entrada.' }), {
        status: 409,
        headers: corsHeaders,
      });
    }

    if (wa.status !== 'active') {
      return new Response(JSON.stringify({ error: 'Ingresso ainda não liberado para entrada.' }), {
        status: 409,
        headers: corsHeaders,
      });
    }

    const owns = await userOwnsAnalyticsEntry(
      supabaseService,
      user.id,
      analyticsId,
      wa.client_user_id as string | null,
    );
    if (!owns) {
      return new Response(JSON.stringify({ error: 'Este ingresso não pertence à sua conta.' }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    const { data: wristbandRow, error: wbError } = await supabaseService
      .from('wristbands')
      .select('event_id')
      .eq('id', wa.wristband_id)
      .maybeSingle();

    if (wbError) throw wbError;

    let entryQrTtlSeconds: number | null = null;
    if (wristbandRow?.event_id) {
      const { data: eventRow, error: evError } = await supabaseService
        .from('events')
        .select('entry_qr_ttl_seconds')
        .eq('id', wristbandRow.event_id)
        .maybeSingle();
      if (evError) {
        console.error('[issue-entry-token] entry_qr_ttl_seconds:', evError);
      } else {
        entryQrTtlSeconds = (eventRow as { entry_qr_ttl_seconds?: number } | null)?.entry_qr_ttl_seconds ?? null;
      }
    }

    const tokenVersion = (wa as { entry_token_version?: number }).entry_token_version ?? 0;

    const issued = await signEntryToken(analyticsId, user.id, {
      ttlSeconds: entryQrTtlSeconds,
      tokenVersion,
    });
    return new Response(JSON.stringify(issued), { status: 200, headers: corsHeaders });
  } catch (err: unknown) {
    console.error('[issue-entry-token]', err);
    const message = err instanceof Error ? err.message : 'Erro interno.';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});

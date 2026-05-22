import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { signEntryToken } from '../_shared/entry-qr-token.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const supabaseService = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

function isPaidReceivable(r: { status?: string; payment_status?: string | null }): boolean {
  return (
    r.status === 'paid' ||
    r.payment_status === 'approved' ||
    r.payment_status === 'authorized'
  );
}

async function userOwnsAnalytics(userId: string, analyticsId: string, clientUserId: string | null): Promise<boolean> {
  if (clientUserId === userId) return true;

  const { data: receivables, error } = await supabaseService
    .from('receivables')
    .select('status, payment_status, wristband_analytics_ids')
    .eq('client_user_id', userId);

  if (error) {
    console.error('[issue-entry-token] receivables:', error);
    return false;
  }

  for (const row of receivables ?? []) {
    if (!isPaidReceivable(row as { status: string; payment_status: string | null })) continue;
    const ids = (row as { wristband_analytics_ids?: string[] | null }).wristband_analytics_ids;
    if (Array.isArray(ids) && ids.includes(analyticsId)) return true;
  }
  return false;
}

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
      .select('id, status, event_type, client_user_id')
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

    const owns = await userOwnsAnalytics(user.id, analyticsId, wa.client_user_id as string | null);
    if (!owns) {
      return new Response(JSON.stringify({ error: 'Este ingresso não pertence à sua conta.' }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    const issued = await signEntryToken(analyticsId, user.id);
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

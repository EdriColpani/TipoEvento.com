import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return json({ error: 'Faça login para entrar na fila.' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

  if (!supabaseUrl || !serviceKey) {
    console.error('[event-checkout-queue] misconfigured');
    return json({ error: 'Servidor de fila indisponível.' }, 500);
  }

  const supabaseAuth = createClient(supabaseUrl, anonKey || serviceKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userError,
  } = await supabaseAuth.auth.getUser();

  if (userError || !user) {
    return json({ error: 'Sessão inválida. Faça login novamente.' }, 401);
  }

  const supabaseService = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const body = await req.json();
    const eventId = body.eventId as string | undefined;
    const sessionToken = body.sessionToken as string | undefined;
    const action = (body.action as string | undefined) ?? 'join';

    if (!eventId && action === 'join') {
      return json({ error: 'eventId obrigatório.' }, 400);
    }

    if (action === 'poll') {
      if (!sessionToken) {
        return json({ error: 'sessionToken obrigatório.' }, 400);
      }

      const { data, error } = await supabaseService.rpc('poll_event_checkout_queue', {
        p_session_token: sessionToken,
      });

      if (error) {
        console.error('[event-checkout-queue] poll rpc:', error.message);
        return json({ error: error.message }, 500);
      }

      if (data && typeof data === 'object' && (data as { ok?: boolean }).ok === false) {
        const msg = (data as { error?: string }).error ?? 'Erro ao consultar fila.';
        return json({ error: msg }, 400);
      }

      return json((data ?? {}) as Record<string, unknown>);
    }

    const { data, error } = await supabaseService.rpc('join_event_checkout_queue', {
      p_event_id: eventId,
      p_client_user_id: user.id,
    });

    if (error) {
      console.error('[event-checkout-queue] join rpc:', error.message);
      return json({ error: error.message }, 500);
    }

    if (data && typeof data === 'object' && (data as { ok?: boolean }).ok === false) {
      const msg = (data as { error?: string }).error ?? 'Erro ao entrar na fila.';
      return json({ error: msg }, 400);
    }

    return json((data ?? {}) as Record<string, unknown>);
  } catch (error) {
    console.error('[event-checkout-queue] catch:', error);
    return json(
      { error: error instanceof Error ? error.message : 'Erro interno na fila virtual.' },
      500,
    );
  }
});

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
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
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  try {
    const body = await req.json();
    const eventId = body.eventId as string | undefined;
    const sessionToken = body.sessionToken as string | undefined;
    const action = (body.action as string | undefined) ?? 'join';

    if (!eventId) {
      return new Response(JSON.stringify({ error: 'eventId required' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    if (action === 'poll') {
      if (!sessionToken) {
        return new Response(JSON.stringify({ error: 'sessionToken required' }), {
          status: 400,
          headers: corsHeaders,
        });
      }

      const { data, error } = await supabaseAnon.rpc('poll_event_checkout_queue', {
        p_session_token: sessionToken,
      });

      if (error) throw error;
      return new Response(JSON.stringify(data), { status: 200, headers: corsHeaders });
    }

    const { data, error } = await supabaseAnon.rpc('join_event_checkout_queue', {
      p_event_id: eventId,
      p_client_user_id: user.id,
    });

    if (error) throw error;
    return new Response(JSON.stringify(data), { status: 200, headers: corsHeaders });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Internal Server Error',
    }), { status: 500, headers: corsHeaders });
  }
});

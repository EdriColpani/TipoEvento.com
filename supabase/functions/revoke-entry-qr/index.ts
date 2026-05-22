import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const supabaseService = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

const ADMIN_MASTER_USER_TYPE_ID = 1;

async function managerCanManageEvent(userId: string, eventId: string, companyId: string): Promise<boolean> {
  const { data: profile } = await supabaseService
    .from('profiles')
    .select('tipo_usuario_id')
    .eq('id', userId)
    .maybeSingle();

  if ((profile as { tipo_usuario_id?: number } | null)?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID) {
    return true;
  }

  const { data: eventRow } = await supabaseService
    .from('events')
    .select('created_by, company_id')
    .eq('id', eventId)
    .maybeSingle();

  if ((eventRow as { created_by?: string } | null)?.created_by === userId) return true;

  const { data: links } = await supabaseService
    .from('user_companies')
    .select('company_id')
    .eq('user_id', userId);

  const companyIds = new Set((links ?? []).map((l) => (l as { company_id: string }).company_id));
  if (companyIds.has(companyId)) return true;
  if (eventRow && companyIds.has((eventRow as { company_id: string }).company_id)) return true;

  return false;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Não autorizado.' }), { status: 401, headers: corsHeaders });
    }

    const supabaseAnon = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userError } = await supabaseAnon.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Sessão inválida.' }), { status: 401, headers: corsHeaders });
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
      .select('id, status, event_type, wristband_id')
      .eq('id', analyticsId)
      .maybeSingle();

    if (waError) throw waError;
    if (!wa) {
      return new Response(JSON.stringify({ error: 'Ingresso não encontrado.' }), { status: 404, headers: corsHeaders });
    }

    const { data: wb, error: wbError } = await supabaseService
      .from('wristbands')
      .select('event_id, company_id')
      .eq('id', wa.wristband_id)
      .maybeSingle();

    if (wbError || !wb) {
      return new Response(JSON.stringify({ error: 'Pulseira não encontrada.' }), { status: 404, headers: corsHeaders });
    }

    const allowed = await managerCanManageEvent(
      user.id,
      (wb as { event_id: string }).event_id,
      (wb as { company_id: string }).company_id,
    );
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Sem permissão para este evento.' }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    if (wa.status === 'used') {
      return new Response(JSON.stringify({ error: 'Ingresso já utilizado na entrada.' }), {
        status: 409,
        headers: corsHeaders,
      });
    }

    const { data: current, error: readErr } = await supabaseService
      .from('wristband_analytics')
      .select('entry_token_version')
      .eq('id', analyticsId)
      .maybeSingle();

    if (readErr) throw readErr;

    const nextVersion = ((current as { entry_token_version?: number } | null)?.entry_token_version ?? 0) + 1;
    const { error: updateErr } = await supabaseService
      .from('wristband_analytics')
      .update({ entry_token_version: nextVersion })
      .eq('id', analyticsId);

    if (updateErr) throw updateErr;

    return new Response(
      JSON.stringify({
        ok: true,
        analyticsId,
        entry_token_version: nextVersion,
        message: 'QR do aplicativo invalidado. O cliente deve abrir o ingresso no app para gerar um novo QR.',
      }),
      { status: 200, headers: corsHeaders },
    );
  } catch (err: unknown) {
    console.error('[revoke-entry-qr]', err);
    const message = err instanceof Error ? err.message : 'Erro interno.';
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: corsHeaders });
  }
});

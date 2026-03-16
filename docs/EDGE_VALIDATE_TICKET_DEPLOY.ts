// Edge Function: validate-ticket
// Deploy: npx supabase functions deploy validate-ticket
// Copie todo o conteúdo deste arquivo para supabase/functions/validate-ticket/index.ts ou para o Dashboard do Supabase.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
  'Content-Type': 'application/json',
};

const supabaseService = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

async function hashApiKey(apiKey: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(apiKey);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = req.headers.get('x-api-key');
    if (!apiKey) {
      return new Response(JSON.stringify({ success: false, error: 'API Key não fornecida. Envie no header x-api-key.' }), { status: 401, headers: corsHeaders });
    }

    const apiKeyHash = await hashApiKey(apiKey);
    const { data: apiKeyData, error: apiKeyError } = await supabaseService
      .from('validation_api_keys')
      .select('id, name, event_id, is_active, expires_at')
      .eq('api_key_hash', apiKeyHash)
      .single();

    if (apiKeyError || !apiKeyData) {
      return new Response(JSON.stringify({ success: false, error: 'API Key inválida ou não encontrada.' }), { status: 401, headers: corsHeaders });
    }

    if (!apiKeyData.is_active) {
      return new Response(JSON.stringify({ success: false, error: 'API Key desativada.' }), { status: 403, headers: corsHeaders });
    }

    if (apiKeyData.expires_at) {
      const expiresAt = new Date(apiKeyData.expires_at);
      if (expiresAt < new Date()) {
        return new Response(JSON.stringify({ success: false, error: 'API Key expirada.' }), { status: 403, headers: corsHeaders });
      }
    }

    const body = await req.json();
    const { wristband_code, validation_type = 'entry' } = body;

    if (!wristband_code) {
      return new Response(JSON.stringify({ success: false, error: 'Código do ingresso não fornecido.' }), { status: 400, headers: corsHeaders });
    }

    if (!['entry', 'exit'].includes(validation_type)) {
      return new Response(JSON.stringify({ success: false, error: 'Tipo de validação inválido. Use "entry" ou "exit".' }), { status: 400, headers: corsHeaders });
    }

    const codeTrim = String(wristband_code).trim();
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (uuidRe.test(codeTrim)) {
      const { data: wa, error: waErr } = await supabaseService
        .from('wristband_analytics')
        .select('id, status, event_type, wristband_id, code_wristbands')
        .eq('id', codeTrim)
        .single();

      if (waErr || !wa) {
        await supabaseService.from('validation_logs').insert({
          api_key_id: apiKeyData.id,
          wristband_code: codeTrim,
          validation_type,
          validation_status: 'invalid',
          validation_message: 'Ingresso (QR) não encontrado.',
          validated_by_name: apiKeyData.name,
          ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null,
          user_agent: req.headers.get('user-agent') || null,
        });
        return new Response(JSON.stringify({ success: false, error: 'Ingresso não encontrado.', wristband_code: codeTrim }), { status: 404, headers: corsHeaders });
      }

      const { data: wristbandData, error: wbErr } = await supabaseService
        .from('wristbands')
        .select('id, code, status, event_id, access_type')
        .eq('id', wa.wristband_id)
        .single();

      if (wbErr || !wristbandData) {
        return new Response(JSON.stringify({ success: false, error: 'Pulseira não encontrada.' }), { status: 404, headers: corsHeaders });
      }

      if (apiKeyData.event_id && apiKeyData.event_id !== wristbandData.event_id) {
        return new Response(JSON.stringify({ success: false, error: 'API Key não autorizada para este evento.' }), { status: 403, headers: corsHeaders });
      }

      const paidOrFree = wa.event_type === 'purchase' || wa.event_type === 'free_registration';
      const ok = wa.status === 'used' && paidOrFree;
      const validationStatus = ok ? 'success' : 'not_paid';
      const validationMessage = ok
        ? (validation_type === 'entry' ? 'Entrada validada (inscrição gratuita).' : 'Saída registrada.')
        : 'Ingresso ainda não liberado ou inválido.';

      await supabaseService.from('validation_logs').insert({
        api_key_id: apiKeyData.id,
        event_id: wristbandData.event_id,
        wristband_id: wristbandData.id,
        wristband_code: wristbandData.code,
        validation_type,
        validation_status: validationStatus,
        validation_message: validationMessage,
        validated_by_name: apiKeyData.name,
        ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null,
        user_agent: req.headers.get('user-agent') || null,
      });

      if (ok && validation_type === 'entry' && wa.event_type === 'free_registration') {
        const { error: regErr } = await supabaseService
          .from('event_registrations')
          .update({ confirmed: true, confirmed_at: new Date().toISOString() })
          .eq('qr_code', codeTrim)
          .eq('event_id', wristbandData.event_id);
        if (regErr) console.error('[validate-ticket] event_registrations.confirmed:', regErr);
      }

      return new Response(JSON.stringify({
        success: ok,
        message: validationMessage,
        wristband_code: wristbandData.code,
        analytics_id: wa.id,
        validation_type,
        wristband_status: wristbandData.status,
        event_id: wristbandData.event_id,
        validated_at: new Date().toISOString(),
        validated_by: apiKeyData.name,
        inscription_confirmed: ok && validation_type === 'entry' && wa.event_type === 'free_registration',
      }), { status: ok ? 200 : 400, headers: corsHeaders });
    }

    if (codeTrim.includes('-')) {
      const codeUpper = codeTrim.toUpperCase();
      const { data: wa, error: waErr } = await supabaseService
        .from('wristband_analytics')
        .select('id, status, event_type, wristband_id, code_wristbands')
        .eq('code_wristbands', codeUpper)
        .single();

      if (!waErr && wa) {
        const { data: wristbandData, error: wbErr } = await supabaseService
          .from('wristbands')
          .select('id, code, status, event_id, access_type')
          .eq('id', wa.wristband_id)
          .single();

        if (!wbErr && wristbandData) {
          if (apiKeyData.event_id && apiKeyData.event_id !== wristbandData.event_id) {
            return new Response(JSON.stringify({ success: false, error: 'API Key não autorizada para este evento.' }), { status: 403, headers: corsHeaders });
          }
          const paidOrFree = wa.event_type === 'purchase' || wa.event_type === 'free_registration';
          const ok = wa.status === 'used' && paidOrFree;
          const validationStatus = ok ? 'success' : 'not_paid';
          const validationMessage = ok
            ? (validation_type === 'entry' ? 'Entrada validada.' : 'Saída registrada.')
            : 'Ingresso ainda não liberado ou inválido.';

          await supabaseService.from('validation_logs').insert({
            api_key_id: apiKeyData.id,
            event_id: wristbandData.event_id,
            wristband_id: wristbandData.id,
            wristband_code: wa.code_wristbands,
            validation_type,
            validation_status: validationStatus,
            validation_message: validationMessage,
            validated_by_name: apiKeyData.name,
            ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null,
            user_agent: req.headers.get('user-agent') || null,
          });

          if (ok && validation_type === 'entry' && wa.event_type === 'free_registration') {
            await supabaseService
              .from('event_registrations')
              .update({ confirmed: true, confirmed_at: new Date().toISOString() })
              .eq('qr_code', wa.id)
              .eq('event_id', wristbandData.event_id);
          }

          return new Response(JSON.stringify({
            success: ok,
            message: validationMessage,
            wristband_code: wa.code_wristbands,
            analytics_id: wa.id,
            validation_type,
            wristband_status: wristbandData.status,
            event_id: wristbandData.event_id,
            validated_at: new Date().toISOString(),
            validated_by: apiKeyData.name,
            inscription_confirmed: ok && validation_type === 'entry' && wa.event_type === 'free_registration',
          }), { status: ok ? 200 : 400, headers: corsHeaders });
        }
      }
    }

    const { data: wristbandData, error: wristbandError } = await supabaseService
      .from('wristbands')
      .select('id, code, status, event_id, access_type')
      .eq('code', codeTrim)
      .single();

    if (wristbandError || !wristbandData) {
      await supabaseService.from('validation_logs').insert({
        api_key_id: apiKeyData.id,
        wristband_code: wristband_code,
        validation_type: validation_type,
        validation_status: 'invalid',
        validation_message: 'Ingresso não encontrado.',
        validated_by_name: apiKeyData.name,
        ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null,
        user_agent: req.headers.get('user-agent') || null,
      });
      return new Response(JSON.stringify({ success: false, error: 'Ingresso não encontrado.', wristband_code: wristband_code }), { status: 404, headers: corsHeaders });
    }

    const { data: keyEventData, error: keyEventError } = await supabaseService
      .from('events')
      .select('id, company_id')
      .eq('id', apiKeyData.event_id)
      .single();

    if (keyEventError || !keyEventData) {
      await supabaseService.from('validation_logs').insert({
        api_key_id: apiKeyData.id,
        event_id: wristbandData.event_id,
        wristband_id: wristbandData.id,
        wristband_code: wristband_code,
        validation_type: validation_type,
        validation_status: 'invalid',
        validation_message: 'Evento da chave não encontrado.',
        validated_by_name: apiKeyData.name,
        ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null,
        user_agent: req.headers.get('user-agent') || null,
      });
      return new Response(JSON.stringify({ success: false, error: 'Evento da chave não encontrado.', wristband_code: wristband_code }), { status: 404, headers: corsHeaders });
    }

    const { data: wristbandEventData, error: wristbandEventError } = await supabaseService
      .from('events')
      .select('id, company_id')
      .eq('id', wristbandData.event_id)
      .single();

    if (wristbandEventError || !wristbandEventData) {
      await supabaseService.from('validation_logs').insert({
        api_key_id: apiKeyData.id,
        event_id: wristbandData.event_id,
        wristband_id: wristbandData.id,
        wristband_code: wristband_code,
        validation_type: validation_type,
        validation_status: 'invalid',
        validation_message: 'Evento do ingresso não encontrado.',
        validated_by_name: apiKeyData.name,
        ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null,
        user_agent: req.headers.get('user-agent') || null,
      });
      return new Response(JSON.stringify({ success: false, error: 'Evento do ingresso não encontrado.', wristband_code: wristband_code }), { status: 404, headers: corsHeaders });
    }

    if (keyEventData.company_id !== wristbandEventData.company_id) {
      await supabaseService.from('validation_logs').insert({
        api_key_id: apiKeyData.id,
        event_id: wristbandData.event_id,
        wristband_id: wristbandData.id,
        wristband_code: wristband_code,
        validation_type: validation_type,
        validation_status: 'invalid',
        validation_message: 'API Key não autorizada: eventos de empresas diferentes.',
        validated_by_name: apiKeyData.name,
        ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null,
        user_agent: req.headers.get('user-agent') || null,
      });
      return new Response(JSON.stringify({ success: false, error: 'API Key não autorizada: eventos de empresas diferentes.', wristband_code: wristband_code }), { status: 403, headers: corsHeaders });
    }

    if (apiKeyData.event_id && apiKeyData.event_id !== wristbandData.event_id) {
      await supabaseService.from('validation_logs').insert({
        api_key_id: apiKeyData.id,
        event_id: wristbandData.event_id,
        wristband_id: wristbandData.id,
        wristband_code: wristband_code,
        validation_type: validation_type,
        validation_status: 'invalid',
        validation_message: 'API Key não autorizada para este evento.',
        validated_by_name: apiKeyData.name,
        ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null,
        user_agent: req.headers.get('user-agent') || null,
      });
      return new Response(JSON.stringify({ success: false, error: 'API Key não autorizada para este evento.', wristband_code: wristband_code }), { status: 403, headers: corsHeaders });
    }

    const { data: analyticsData, error: analyticsError } = await supabaseService
      .from('wristband_analytics')
      .select('id, status, client_user_id, event_type, event_data')
      .eq('wristband_id', wristbandData.id)
      .eq('event_type', 'purchase')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    let validationStatus = 'success';
    let validationMessage = validation_type === 'entry' ? 'Entrada validada com sucesso.' : 'Saída validada com sucesso.';
    let httpStatus = 200;

    if (!analyticsData || analyticsData.status !== 'used') {
      validationStatus = 'not_paid';
      validationMessage = 'Ingresso não foi pago ou não está associado a uma compra.';
      httpStatus = 400;
    } else if (wristbandData.status === 'cancelled' || wristbandData.status === 'lost') {
      validationStatus = 'invalid';
      validationMessage = wristbandData.status === 'cancelled' ? 'Ingresso cancelado.' : 'Ingresso perdido.';
      httpStatus = 400;
    } else if (wristbandData.status !== 'active' && wristbandData.status !== 'used') {
      validationStatus = 'invalid';
      validationMessage = 'Ingresso não está ativo.';
      httpStatus = 400;
    }

    await supabaseService.from('validation_logs').insert({
      api_key_id: apiKeyData.id,
      event_id: wristbandData.event_id,
      wristband_id: wristbandData.id,
      wristband_code: wristband_code,
      validation_type: validation_type,
      validation_status: validationStatus,
      validation_message: validationMessage,
      validated_by_name: apiKeyData.name,
      client_user_id: analyticsData?.client_user_id || null,
      ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null,
      user_agent: req.headers.get('user-agent') || null,
    });

    if (validationStatus === 'success' && validation_type === 'entry' && wristbandData.status === 'active') {
      await supabaseService.from('wristbands').update({ status: 'used' }).eq('id', wristbandData.id);
    }

    return new Response(JSON.stringify({
      success: validationStatus === 'success',
      message: validationMessage,
      wristband_code: wristband_code,
      validation_type: validation_type,
      wristband_status: wristbandData.status,
      event_id: wristbandData.event_id,
      validated_at: new Date().toISOString(),
      validated_by: apiKeyData.name
    }), { status: httpStatus, headers: corsHeaders });

  } catch (error: any) {
    console.error('Erro na validação:', error);
    return new Response(JSON.stringify({ success: false, error: 'Erro interno do servidor.', details: error.message }), { status: 500, headers: corsHeaders });
  }
});

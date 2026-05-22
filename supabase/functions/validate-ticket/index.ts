import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { isDynamicEntryQr, verifyEntryToken } from '../_shared/entry-qr-token.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
  'Content-Type': 'application/json',
};

// Initialize Supabase client with Service Role Key for secure backend operations
const supabaseService = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

// Função para gerar hash da API key (usando SHA-256 nativo do Deno)
async function hashApiKey(apiKey: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(apiKey);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// Insere movimentação da pulseira evitando duplicados em milissegundos muito próximos
async function insertMovementIfNotDuplicate(params: {
  event_id: string;
  wristband_id: string;
  api_key_id: string;
  movement_type: 'entry' | 'exit';
}) {
  const now = new Date();

  const { data: lastRows, error: lastErr } = await supabaseService
    .from('wristband_movements')
    .select('movement_type, validated_at')
    .eq('wristband_id', params.wristband_id)
    .order('validated_at', { ascending: false })
    .limit(1);

  if (!lastErr && lastRows && lastRows.length > 0) {
    const last = lastRows[0] as { movement_type: string; validated_at: string };
    const lastTime = last.validated_at ? new Date(last.validated_at) : null;
    if (
      lastTime &&
      last.movement_type === params.movement_type &&
      now.getTime() - lastTime.getTime() < 1000 // menos de 1 segundo
    ) {
      // Provavelmente a mesma leitura disparada duas vezes; não insere de novo
      return;
    }
  }

  const { error } = await supabaseService
    .from('wristband_movements')
    .insert({
      event_id: params.event_id,
      wristband_id: params.wristband_id,
      api_key_id: params.api_key_id,
      movement_type: params.movement_type,
      validated_at: now.toISOString(),
    });

  if (error) {
    console.error('[validate-ticket] erro ao registrar wristband_movement:', error);
  }
}

type AnalyticsAccessRow = { id: string; status: string; event_type: string };

/** Regras de entrada/saída por tipo de ingresso (compra = active na entrada, vira used após validar). */
function evaluateAnalyticsAccess(
  wa: AnalyticsAccessRow,
  validation_type: 'entry' | 'exit',
): { ok: boolean; message: string } {
  const paidOrFree = wa.event_type === 'purchase' || wa.event_type === 'free_registration';
  if (!paidOrFree) {
    return { ok: false, message: 'Tipo de ingresso inválido.' };
  }

  if (validation_type === 'exit') {
    const ok =
      wa.status === 'used' ||
      (wa.event_type === 'purchase' && wa.status === 'active');
    return {
      ok,
      message: ok ? '' : 'Ingresso ainda não liberado ou inválido.',
    };
  }

  if (wa.event_type === 'purchase') {
    if (wa.status === 'used') {
      return { ok: false, message: 'Ingresso já utilizado na entrada.' };
    }
    if (wa.status === 'active') {
      return { ok: true, message: '' };
    }
    return { ok: false, message: 'Ingresso ainda não liberado ou inválido.' };
  }

  if (wa.status === 'used') {
    return { ok: true, message: '' };
  }
  return { ok: false, message: 'Ingresso ainda não liberado ou inválido.' };
}

async function eventAllowsPrintedTickets(eventId: string): Promise<boolean> {
  const { data, error } = await supabaseService
    .from('events')
    .select('allow_printed_tickets')
    .eq('id', eventId)
    .maybeSingle();
  if (error) {
    console.error('[validate-ticket] allow_printed_tickets:', error);
    return false;
  }
  return (data as { allow_printed_tickets?: boolean } | null)?.allow_printed_tickets === true;
}

async function rejectPrintedPurchaseIfDigitalOnly(params: {
  eventId: string;
  eventType: string;
  validationType: string;
  scannedViaDynamicQr: boolean;
}): Promise<{ blocked: boolean; message: string; error_code: string } | null> {
  if (
    params.scannedViaDynamicQr ||
    params.eventType !== 'purchase' ||
    params.validationType !== 'entry'
  ) {
    return null;
  }
  const allowsPrinted = await eventAllowsPrintedTickets(params.eventId);
  if (allowsPrinted) return null;
  return {
    blocked: true,
    message: 'Este evento exige QR do aplicativo. Peça ao cliente para abrir o ingresso no app.',
    error_code: 'digital_only',
  };
}

async function markPurchaseAnalyticsUsedOnEntry(analyticsId: string): Promise<void> {
  const { error } = await supabaseService
    .from('wristband_analytics')
    .update({ status: 'used' })
    .eq('id', analyticsId)
    .eq('event_type', 'purchase')
    .eq('status', 'active');
  if (error) {
    console.error('[validate-ticket] falha ao marcar ingresso purchase como used:', error);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Obter API Key do header
    const apiKey = req.headers.get('x-api-key');
    if (!apiKey) {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'API Key não fornecida. Envie no header x-api-key.' 
      }), { 
        status: 401, 
        headers: corsHeaders 
      });
    }

    // 2. Validar API Key
    const apiKeyHash = await hashApiKey(apiKey);
    const { data: apiKeyData, error: apiKeyError } = await supabaseService
      .from('validation_api_keys')
      .select('id, name, event_id, is_active, expires_at')
      .eq('api_key_hash', apiKeyHash)
      .single();

    if (apiKeyError || !apiKeyData) {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'API Key inválida ou não encontrada.' 
      }), { 
        status: 401, 
        headers: corsHeaders 
      });
    }

    // 3. Verificar se a chave está ativa
    if (!apiKeyData.is_active) {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'API Key desativada.' 
      }), { 
        status: 403, 
        headers: corsHeaders 
      });
    }

    // 4. Verificar se a chave não expirou
    if (apiKeyData.expires_at) {
      const expiresAt = new Date(apiKeyData.expires_at);
      if (expiresAt < new Date()) {
        return new Response(JSON.stringify({ 
          success: false,
          error: 'API Key expirada.' 
        }), { 
          status: 403, 
          headers: corsHeaders 
        });
      }
    }

    // 5. Obter dados da requisição
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const verify_key_only = body.verify_key_only === true;
    const wristband_code = body.wristband_code as string | undefined;
    const validation_type = (body.validation_type === 'exit' ? 'exit' : 'entry') as 'entry' | 'exit';

    // 5a. Somente validar chave (validador: liberar UI antes de ler ingressos)
    if (verify_key_only) {
      let event_title: string | null = null;
      if (apiKeyData.event_id) {
        const { data: ev } = await supabaseService
          .from('events')
          .select('title')
          .eq('id', apiKeyData.event_id)
          .maybeSingle();
        event_title = (ev as { title?: string } | null)?.title ?? null;
      }
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Chave de acesso válida.',
          validated_by: apiKeyData.name,
          event_title,
          event_id: apiKeyData.event_id,
        }),
        { status: 200, headers: corsHeaders },
      );
    }

    if (!wristband_code || String(wristband_code).trim() === '') {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'Código do ingresso não fornecido.' 
      }), { 
        status: 400, 
        headers: corsHeaders 
      });
    }

    if (!['entry', 'exit'].includes(validation_type)) {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'Tipo de validação inválido. Use "entry" ou "exit".' 
      }), { 
        status: 400, 
        headers: corsHeaders 
      });
    }

    let codeTrim = String(wristband_code).trim();
    let scannedViaDynamicQr = false;

    if (isDynamicEntryQr(codeTrim)) {
      const verified = await verifyEntryToken(codeTrim);
      if (!verified.ok) {
        await supabaseService.from('validation_logs').insert({
          api_key_id: apiKeyData.id,
          wristband_code: codeTrim.slice(0, 120),
          validation_type,
          validation_status: 'invalid',
          validation_message: verified.message,
          validated_by_name: apiKeyData.name,
          ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null,
          user_agent: req.headers.get('user-agent') || null,
        });
        return new Response(
          JSON.stringify({
            success: false,
            error: verified.message,
            error_code: verified.error_code,
            wristband_code: codeTrim.slice(0, 80),
          }),
          { status: 400, headers: corsHeaders },
        );
      }
      codeTrim = verified.analyticsId;
      scannedViaDynamicQr = true;
    }

    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    // 5b. QR = id de wristband_analytics (UUID) ou resolvido de EF1
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
        return new Response(JSON.stringify({ success: false, error: 'Ingresso não encontrado.' }), { status: 404, headers: corsHeaders });
      }

      if (apiKeyData.event_id && apiKeyData.event_id !== wristbandData.event_id) {
        return new Response(JSON.stringify({ success: false, error: 'API Key não autorizada para este evento.' }), { status: 403, headers: corsHeaders });
      }

      const digitalOnlyBlock = await rejectPrintedPurchaseIfDigitalOnly({
        eventId: wristbandData.event_id,
        eventType: wa.event_type,
        validationType: validation_type,
        scannedViaDynamicQr,
      });
      if (digitalOnlyBlock) {
        await supabaseService.from('validation_logs').insert({
          api_key_id: apiKeyData.id,
          event_id: wristbandData.event_id,
          wristband_id: wristbandData.id,
          wristband_code: codeTrim,
          validation_type,
          validation_status: 'invalid',
          validation_message: digitalOnlyBlock.message,
          validated_by_name: apiKeyData.name,
          ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null,
          user_agent: req.headers.get('user-agent') || null,
        });
        return new Response(
          JSON.stringify({
            success: false,
            error: digitalOnlyBlock.message,
            error_code: digitalOnlyBlock.error_code,
            wristband_code: codeTrim,
          }),
          { status: 400, headers: corsHeaders },
        );
      }

      const access = evaluateAnalyticsAccess(wa, validation_type);
      const ok = access.ok;
      const validationStatus = ok ? 'success' : (wa.event_type === 'purchase' && wa.status === 'used' && validation_type === 'entry' ? 'invalid' : 'not_paid');
      const validationMessage = ok
        ? (validation_type === 'entry'
          ? (wa.event_type === 'purchase'
            ? (scannedViaDynamicQr ? 'Entrada validada (QR app).' : 'Entrada validada (ingresso impresso).')
            : 'Entrada validada (inscrição gratuita).')
          : 'Saída registrada.')
        : access.message;

      const { data: validationLog, error: validationLogError } = await supabaseService.from('validation_logs').insert({
        api_key_id: apiKeyData.id,
        event_id: wristbandData.event_id,
        wristband_id: wristbandData.id,
        wristband_code: scannedViaDynamicQr ? 'EF1:dynamic' : wristbandData.code,
        validation_type,
        validation_status: validationStatus,
        validation_message: validationMessage,
        validated_by_name: apiKeyData.name,
        ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null,
        user_agent: req.headers.get('user-agent') || null,
      }).select('id').single();

      if (validationLogError) {
        console.error('[validate-ticket] erro ao registrar validation_log (UUID):', validationLogError);
      }

      // Registrar movimento analítico por pulseira somente quando a validação é bem-sucedida
      if (ok && validationLog && validationLog.id) {
        await insertMovementIfNotDuplicate({
          event_id: wristbandData.event_id,
          wristband_id: wristbandData.id,
          api_key_id: apiKeyData.id,
          movement_type: validation_type as 'entry' | 'exit',
        });
      }

      if (ok && validation_type === 'entry' && wa.event_type === 'purchase') {
        await markPurchaseAnalyticsUsedOnEntry(wa.id);
      }

      // Inscrição gratuita: marcar presença e data/hora da confirmação na entrada
      if (ok && validation_type === 'entry' && wa.event_type === 'free_registration') {
        const { error: regErr } = await supabaseService
          .from('event_registrations')
          .update({ confirmed: true, confirmed_at: new Date().toISOString() })
          .eq('qr_code', codeTrim)
          .eq('event_id', wristbandData.event_id);
        if (regErr) {
          console.error('[validate-ticket] event_registrations.confirmed:', regErr);
        }
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

    // 5c. Código no formato BASE-NNN (ex: CHAVA-001) = code_wristbands em wristband_analytics
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

          const digitalOnlyBlock = await rejectPrintedPurchaseIfDigitalOnly({
            eventId: wristbandData.event_id,
            eventType: wa.event_type,
            validationType: validation_type,
            scannedViaDynamicQr: false,
          });
          if (digitalOnlyBlock) {
            await supabaseService.from('validation_logs').insert({
              api_key_id: apiKeyData.id,
              event_id: wristbandData.event_id,
              wristband_id: wristbandData.id,
              wristband_code: wa.code_wristbands,
              validation_type,
              validation_status: 'invalid',
              validation_message: digitalOnlyBlock.message,
              validated_by_name: apiKeyData.name,
              ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null,
              user_agent: req.headers.get('user-agent') || null,
            });
            return new Response(
              JSON.stringify({
                success: false,
                error: digitalOnlyBlock.message,
                error_code: digitalOnlyBlock.error_code,
                wristband_code: wa.code_wristbands,
              }),
              { status: 400, headers: corsHeaders },
            );
          }

          const access = evaluateAnalyticsAccess(wa, validation_type);
          const ok = access.ok;
          const validationStatus = ok ? 'success' : (wa.event_type === 'purchase' && wa.status === 'used' && validation_type === 'entry' ? 'invalid' : 'not_paid');
          const validationMessage = ok
            ? (validation_type === 'entry' ? 'Entrada validada.' : 'Saída registrada.')
            : access.message;

          const { data: validationLog, error: validationLogError } = await supabaseService.from('validation_logs').insert({
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
          }).select('id').single();

          if (validationLogError) {
            console.error('[validate-ticket] erro ao registrar validation_log (BASE-NNN):', validationLogError);
          }

          if (ok && validationLog && validationLog.id) {
            await insertMovementIfNotDuplicate({
              event_id: wristbandData.event_id,
              wristband_id: wristbandData.id,
              api_key_id: apiKeyData.id,
              movement_type: validation_type as 'entry' | 'exit',
            });
          }

          if (ok && validation_type === 'entry' && wa.event_type === 'purchase') {
            await markPurchaseAnalyticsUsedOnEntry(wa.id);
          }

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

    // 6. Buscar o ingresso/pulseira (código base do lote, ex: CHAVA sem sufixo)
    const { data: wristbandData, error: wristbandError } = await supabaseService
      .from('wristbands')
      .select('id, code, status, event_id, access_type')
      .eq('code', codeTrim)
      .single();

    if (wristbandError || !wristbandData) {
      // Registrar log de erro
      await supabaseService
        .from('validation_logs')
        .insert({
          api_key_id: apiKeyData.id,
          wristband_code: wristband_code,
          validation_type: validation_type,
          validation_status: 'invalid',
          validation_message: 'Ingresso não encontrado.',
          validated_by_name: apiKeyData.name,
          ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null,
          user_agent: req.headers.get('user-agent') || null,
        });

      return new Response(JSON.stringify({ 
        success: false,
        error: 'Ingresso não encontrado.',
        wristband_code: wristband_code
      }), { 
        status: 404, 
        headers: corsHeaders 
      });
    }

    // 6.1. Buscar dados do evento da chave para verificar company_id
    const { data: keyEventData, error: keyEventError } = await supabaseService
      .from('events')
      .select('id, company_id')
      .eq('id', apiKeyData.event_id)
      .single();

    if (keyEventError || !keyEventData) {
      await supabaseService
        .from('validation_logs')
        .insert({
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

      return new Response(JSON.stringify({ 
        success: false,
        error: 'Evento da chave não encontrado.',
        wristband_code: wristband_code
      }), { 
        status: 404, 
        headers: corsHeaders 
      });
    }

    // 6.2. Buscar dados do evento do ingresso para verificar company_id
    const { data: wristbandEventData, error: wristbandEventError } = await supabaseService
      .from('events')
      .select('id, company_id')
      .eq('id', wristbandData.event_id)
      .single();

    if (wristbandEventError || !wristbandEventData) {
      await supabaseService
        .from('validation_logs')
        .insert({
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

      return new Response(JSON.stringify({ 
        success: false,
        error: 'Evento do ingresso não encontrado.',
        wristband_code: wristband_code
      }), { 
        status: 404, 
        headers: corsHeaders 
      });
    }

    // 6.3. Verificar se os eventos pertencem à mesma empresa
    if (keyEventData.company_id !== wristbandEventData.company_id) {
      await supabaseService
        .from('validation_logs')
        .insert({
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

      return new Response(JSON.stringify({ 
        success: false,
        error: 'API Key não autorizada: eventos de empresas diferentes.',
        wristband_code: wristband_code
      }), { 
        status: 403, 
        headers: corsHeaders 
      });
    }

    // 7. Verificar se o evento está permitido para esta API key
    if (apiKeyData.event_id && apiKeyData.event_id !== wristbandData.event_id) {
      await supabaseService
        .from('validation_logs')
        .insert({
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

      return new Response(JSON.stringify({ 
        success: false,
        error: 'API Key não autorizada para este evento.',
        wristband_code: wristband_code
      }), { 
        status: 403, 
        headers: corsHeaders 
      });
    }

    // 8. Buscar analytics do ingresso para verificar status de pagamento
    const { data: analyticsData, error: analyticsError } = await supabaseService
      .from('wristband_analytics')
      .select('id, status, client_user_id, event_type, event_data')
      .eq('wristband_id', wristbandData.id)
      .eq('event_type', 'purchase')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // 9. Validar status do ingresso
    let validationStatus = 'success';
    let validationMessage = validation_type === 'entry' ? 'Entrada validada com sucesso.' : 'Saída validada com sucesso.';
    let httpStatus = 200;

    // Verificar se o ingresso foi pago (compra paga fica em analytics como active ou used)
    const purchaseAnalyticsOk =
      analyticsData &&
      (analyticsData.status === 'used' ||
        (analyticsData.status === 'active' && analyticsData.event_type === 'purchase'));
    if (!purchaseAnalyticsOk) {
      validationStatus = 'not_paid';
      validationMessage = 'Ingresso não foi pago ou não está associado a uma compra.';
      httpStatus = 400;
    } else if (wristbandData.status === 'cancelled' || wristbandData.status === 'lost') {
      validationStatus = 'invalid';
      validationMessage = `Ingresso ${wristbandData.status === 'cancelled' ? 'cancelado' : 'perdido'}.`;
      httpStatus = 400;
    } else if (wristbandData.status !== 'active' && wristbandData.status !== 'used') {
      validationStatus = 'invalid';
      validationMessage = 'Ingresso não está ativo.';
      httpStatus = 400;
    }

    // 10. Registrar log de validação
    const { data: validationLog, error: logError } = await supabaseService
      .from('validation_logs')
      .insert({
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
      }).select('id').single();

    if (logError) {
      console.error('Erro ao registrar log de validação:', logError);
    }

    // 11.1 Registrar movimento analítico por pulseira quando a validação é bem-sucedida
    if (validationStatus === 'success' && validationLog && validationLog.id) {
      await insertMovementIfNotDuplicate({
        event_id: wristbandData.event_id,
        wristband_id: wristbandData.id,
        api_key_id: apiKeyData.id,
        movement_type: validation_type as 'entry' | 'exit',
      });
    }

    // 11. Se a validação foi bem-sucedida e for entrada, podemos atualizar o status
    if (validationStatus === 'success' && validation_type === 'entry') {
      // Opcional: Atualizar status do wristband para 'used' se ainda estiver 'active'
      if (wristbandData.status === 'active') {
        await supabaseService
          .from('wristbands')
          .update({ status: 'used' })
          .eq('id', wristbandData.id);
      }
    }

    // 12. Retornar resposta
    return new Response(JSON.stringify({ 
      success: validationStatus === 'success',
      message: validationMessage,
      wristband_code: wristband_code,
      validation_type: validation_type,
      wristband_status: wristbandData.status,
      event_id: wristbandData.event_id,
      validated_at: new Date().toISOString(),
      validated_by: apiKeyData.name
    }), { 
      status: httpStatus, 
      headers: corsHeaders 
    });

  } catch (error: any) {
    console.error('Erro na validação:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: 'Erro interno do servidor.',
      details: error.message 
    }), { 
      status: 500, 
      headers: corsHeaders 
    });
  }
});


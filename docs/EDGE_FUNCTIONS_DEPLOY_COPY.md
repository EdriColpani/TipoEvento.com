# Edge Functions — código para copiar e deploy

Use os blocos abaixo para colar nos arquivos ou no Dashboard do Supabase e depois rode o deploy.

---

## Comandos de deploy (copiar e rodar no terminal)

```bash
npx supabase functions deploy create-wristbands-batch
npx supabase functions deploy validate-ticket
```

Ou os dois de uma vez:

```bash
npx supabase functions deploy create-wristbands-batch && npx supabase functions deploy validate-ticket
```

---

## 1. create-wristbands-batch

**Arquivo:** `supabase/functions/create-wristbands-batch/index.ts`

Copie todo o bloco abaixo e substitua o conteúdo do arquivo, ou crie a função no Dashboard com este código.

```ts
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
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

  // 1. Authentication Check
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized: Missing Authorization header' }), {
      status: 401,
      headers: corsHeaders
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized: Invalid token or user not found' }), {
      status: 401,
      headers: corsHeaders
    });
  }
  const userId = user.id;

  try {
    const { event_id, company_id, manager_user_id, base_code, access_type, price, quantity } = await req.json();

    if (!event_id || !company_id || !manager_user_id || !base_code || !access_type || price === undefined || quantity === undefined || quantity < 1) {
      return new Response(JSON.stringify({ error: 'Missing or invalid required fields.' }), {
        status: 400,
        headers: corsHeaders
      });
    }

    const { data: companyProfile, error: companyProfileError } = await supabase
        .from('companies')
        .select('id')
        .eq('id', company_id)
        .eq('user_id', userId)
        .single();

    if (companyProfileError || !companyProfile) {
        return new Response(JSON.stringify({ error: 'Forbidden: User is not authorized to create wristbands for this company.' }), {
            status: 403,
            headers: corsHeaders
        });
    }

    const wristbandData = {
        event_id: event_id,
        company_id: company_id,
        manager_user_id: manager_user_id,
        code: base_code,
        access_type: access_type,
        status: 'active',
        price: price,
    };

    const { data: insertedWristband, error: insertWristbandError } = await supabase
        .from('wristbands')
        .insert([wristbandData])
        .select('id, code')
        .single();

    if (insertWristbandError) {
        if (insertWristbandError.code === '23505') {
            return new Response(JSON.stringify({ error: "O Código Base informado já está em uso. Tente um código diferente." }), {
                status: 409,
                headers: corsHeaders
            });
        }
        throw insertWristbandError;
    }

    const wristbandId = insertedWristband.id;
    const wristbandCode = insertedWristband.code;

    const BATCH_SIZE = 100;
    let totalInsertedAnalytics = 0;

    for (let i = 0; i < quantity; i += BATCH_SIZE) {
        const batchToInsert = [];
        const currentBatchSize = Math.min(BATCH_SIZE, quantity - i);

        for (let j = 0; j < currentBatchSize; j++) {
            const seq = i + j + 1;
            const uniqueCode = `${wristbandCode}-${String(seq).padStart(3, '0')}`;
            batchToInsert.push({
                wristband_id: wristbandId,
                event_type: 'creation',
                client_user_id: null,
                code_wristbands: uniqueCode,
                status: 'active',
                sequential_number: seq,
                event_data: {
                    code: uniqueCode,
                    access_type: access_type,
                    price: price,
                    manager_id: manager_user_id,
                    event_id: event_id,
                    initial_status: 'active',
                    sequential_entry: seq,
                },
            });
        }

        const { error: analyticsError } = await supabase
            .from('wristband_analytics')
            .insert(batchToInsert);

        if (analyticsError) {
            console.error(`Warning: Failed to insert analytics batch starting at index ${i}:`, analyticsError);
            throw analyticsError;
        }
        totalInsertedAnalytics += currentBatchSize;
    }

    return new Response(JSON.stringify({
        message: `Successfully created wristband "${wristbandCode}" and ${totalInsertedAnalytics} analytics records.`,
        count: totalInsertedAnalytics
    }), {
        status: 200,
        headers: corsHeaders
    });

  } catch (error: any) {
    console.error('Edge Function Error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), {
      status: 500,
      headers: corsHeaders
    });
  }
});
```

---

## 2. validate-ticket

**Arquivo:** `supabase/functions/validate-ticket/index.ts`

Copie todo o bloco abaixo e substitua o conteúdo do arquivo, ou crie a função no Dashboard com este código.

```ts
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

    // 5b. QR de inscrição gratuita = id de wristband_analytics (UUID)
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

    // 5c. Código no formato BASE-NNN (ex: CHAVA-001)
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

    // 6. Código base do lote (ex: CHAVA sem sufixo)
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
        validation_type,
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
        validation_type,
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
        validation_type,
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
        validation_type,
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
```

---

**Observação:** Os arquivos já estão no projeto. Se você só for fazer deploy pelo CLI, basta rodar os comandos do topo; use este doc quando precisar colar o código em outro lugar (ex.: Dashboard do Supabase).

---

## 3. send-free-registration-email (código da pulseira no e-mail)

**Arquivo:** `supabase/functions/send-free-registration-email/index.ts`

Deploy:

```bash
npx supabase functions deploy send-free-registration-email
```

Copie todo o bloco abaixo para substituir o conteúdo da função.

```ts
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const RESEND_FROM = "EventFest <noreply@EventFest.com.br>";

const json200 = (obj: Record<string, unknown>) =>
  new Response(JSON.stringify(obj), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type RequestBody = {
  qrCode?: string;
  wristbandCode?: string;
  email?: string;
  eventTitle?: string;
  eventDate?: string;
  eventTime?: string;
  eventLocation?: string;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json200({ success: false, error: "method_not_allowed" });
  }

  try {
    let body: RequestBody = {};
    try {
      body = (await req.json()) as RequestBody;
    } catch {
      return json200({ success: false, error: "invalid_json" });
    }

    const { qrCode, wristbandCode, email, eventTitle, eventDate, eventTime, eventLocation } =
      body;
    if (!qrCode || !email) {
      return json200({ success: false, error: "missing_qr_or_email" });
    }

    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!url || !key) {
      console.error(
        "[send-free-registration-email] SUPABASE_URL ou SERVICE_ROLE ausente",
      );
      return json200({ success: false, error: "server_misconfigured" });
    }

    const supabaseService = createClient(url, key, {
      auth: { persistSession: false },
    });

    const { data: registration, error: registrationError } =
      await supabaseService
        .from("event_registrations")
        .select("id, email_sent_at")
        .eq("qr_code", qrCode)
        .maybeSingle();

    if (registrationError) {
      console.error("[send-free-registration-email] db:", registrationError);
      return json200({
        success: false,
        error: "db_read",
        detail: registrationError.message,
      });
    }

    if (!registration) {
      return json200({ success: false, error: "registration_not_found" });
    }

    if (registration.email_sent_at) {
      return json200({ success: true, alreadySent: true });
    }

    const resendKey = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
    if (!resendKey) {
      console.error("[send-free-registration-email] RESEND_API_KEY ausente");
      return json200({ success: false, error: "no_resend_key" });
    }

    const toEmail = email.trim();
    const subject = `Ingresso — ${eventTitle ?? "Evento"}`.trim();
    const dateLine = eventDate ? `Data: <strong>${eventDate}</strong>` : "";
    const timeLine = eventTime
      ? ` · Horário: <strong>${eventTime}</strong>`
      : "";
    const locationLine = eventLocation
      ? `<br />Local: <strong>${eventLocation}</strong>`
      : "";

    const codeFallbackBlock = wristbandCode?.trim()
      ? `<p style="font-size:14px;margin-top:16px;padding:12px;background:#f5f5f5;border-radius:8px"><strong>Código da pulseira:</strong> <span style="font-family:monospace;font-size:16px">${wristbandCode}</span></p>
  <p style="font-size:13px;color:#555">Se o QR code não funcionar na entrada, informe este código ao organizador.</p>`
      : "";

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<div style="font-family:Arial,sans-serif;color:#111;max-width:600px;margin:0 auto;padding:20px">
  <h1 style="font-size:18px">Inscrição confirmada</h1>
  <p><strong>${eventTitle ?? "Evento"}</strong></p>
  <p style="color:#555;font-size:14px">${dateLine}${timeLine}${locationLine}</p>
  <p style="font-size:14px"><strong>É obrigatório apresentar este QR Code na entrada</strong> para confirmar sua presença no evento. Sem o QR, a entrada pode ser recusada.</p>
  <p><img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrCode)}" width="200" height="200" alt="QR" /></p>
  ${codeFallbackBlock}
  <p style="font-size:12px;color:#666;margin-top:20px">EventFest · EventFest.com.br</p>
</div></body></html>`;

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 20000);

    let emailResponse: Response;
    try {
      emailResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: RESEND_FROM,
          to: toEmail,
          subject,
          html,
        }),
      });
    } catch (e) {
      clearTimeout(t);
      console.error("[send-free-registration-email] fetch Resend:", e);
      return json200({ success: false, error: "resend_timeout_or_network" });
    }
    clearTimeout(t);

    const resendData = await emailResponse.json().catch(() => ({}));

    if (!emailResponse.ok) {
      console.error(
        "[send-free-registration-email] Resend:",
        emailResponse.status,
        resendData,
      );
      return json200({
        success: false,
        error: "resend_rejected",
        status: emailResponse.status,
        detail: JSON.stringify(resendData).slice(0, 500),
      });
    }

    const { error: updateError } = await supabaseService
      .from("event_registrations")
      .update({ email_sent_at: new Date().toISOString() })
      .eq("qr_code", qrCode);

    if (updateError) {
      console.error("[send-free-registration-email] update:", updateError);
    }

    console.info("[send-free-registration-email] ok →", toEmail);
    return json200({ success: true });
  } catch (err) {
    console.error("[send-free-registration-email] catch:", err);
    return json200({ success: false, error: "unexpected" });
  }
});
```

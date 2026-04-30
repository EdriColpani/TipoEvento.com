import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

/** Origem pública (https://loja.com) para back_urls — alinha com o domínio onde o usuário compra (evita PA_UNAUTHORIZED no MP). */
function resolveCheckoutOrigin(
  body: Record<string, unknown>,
  siteUrlEnv: string,
): string {
  const envBase = siteUrlEnv.replace(/\/$/, '');
  const useDynamicBackUrls = (Deno.env.get('USE_DYNAMIC_BACK_URLS') ?? '').trim() === 'true';
  const allowLocalhostCheckout = (Deno.env.get('ALLOW_LOCALHOST_CHECKOUT') ?? '').trim() === 'true';
  const raw = typeof body.clientOrigin === 'string' ? body.clientOrigin.trim() : '';
  let clientOrigin = '';
  let clientIsLocalhost = false;
  if (raw) {
    try {
      const u = new URL(raw);
      clientIsLocalhost = u.protocol === 'http:' && u.hostname === 'localhost';
      if (u.protocol === 'https:' || clientIsLocalhost) {
        clientOrigin = u.origin;
      }
    } catch (_error) {
      /* ignore */
    }
  }
  const allowCsv = (Deno.env.get('CHECKOUT_PUBLIC_ORIGINS') ?? '').trim();
  const allowed = allowCsv
    ? allowCsv.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean)
    : [];

  // Modo estável (padrão): sempre usa SITE_URL para evitar bloqueios de PolicyAgent.
  // Só usa clientOrigin quando USE_DYNAMIC_BACK_URLS=true.
  if (!useDynamicBackUrls) {
    if (!envBase) {
      console.warn(
        '[create-payment-preference] SITE_URL vazio e USE_DYNAMIC_BACK_URLS=false; sem origem válida para back_urls.',
      );
    }
    return envBase;
  }

  if (clientOrigin) {
    // Mercado Pago frequentemente bloqueia back_urls localhost (PolicyAgent).
    // Em dev local, preferimos SITE_URL por padrão; só usa localhost se explicitamente liberado.
    if (clientIsLocalhost && !allowLocalhostCheckout) {
      console.warn(
        '[create-payment-preference] clientOrigin é localhost e ALLOW_LOCALHOST_CHECKOUT!=true; usando SITE_URL para evitar bloqueio do Mercado Pago.',
      );
      return envBase;
    }
    if (allowed.length === 0 || allowed.includes(clientOrigin)) {
      return clientOrigin;
    }
    console.warn(
      `[create-payment-preference] clientOrigin ${clientOrigin} não está em CHECKOUT_PUBLIC_ORIGINS; usando SITE_URL.`,
    );
  }
  return envBase;
}

// Initialize Supabase client with Service Role Key for secure backend operations
const supabaseService = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // 1. Authentication Check (using user's JWT for client identification)
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized: Missing Authorization header' }), { 
      status: 401, 
      headers: corsHeaders 
    });
  }
  
  const supabaseAnon = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: userError } = await supabaseAnon.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized: Invalid token or user not found' }), { 
      status: 401, 
      headers: corsHeaders 
    });
  }
  const clientUserId = user.id;
  console.log(`[DEBUG] Client authenticated. User ID: ${clientUserId}`);

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const { eventId, purchaseItems } = body as {
      eventId?: string;
      purchaseItems?: unknown[];
    };

    const siteUrlEnv = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '');
    const useDynamicBackUrls = (Deno.env.get('USE_DYNAMIC_BACK_URLS') ?? '').trim() === 'true';
    const checkoutOrigin = resolveCheckoutOrigin(body, siteUrlEnv);
    console.log(
      `[DEBUG] Event ID: ${eventId}. SITE_URL(env)=${siteUrlEnv || '(vazio)'} USE_DYNAMIC_BACK_URLS=${useDynamicBackUrls} checkoutOrigin(usado)=${checkoutOrigin}`,
    );

    if (!eventId || !Array.isArray(purchaseItems) || purchaseItems.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing event details or purchase items' }), { 
        status: 400, 
        headers: corsHeaders 
      });
    }
    
    // Calculate total value
    const totalValue = purchaseItems.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0);
    
    // 2. Fetch Event Details to get Manager ID (corrigido: usar created_by em vez de user_id)
    const { data: eventData, error: eventError } = await supabaseService
        .from('events')
        .select('created_by, company_id, is_active')
        .eq('id', eventId)
        .single();

    if (eventError || !eventData) {
        console.error(`[DEBUG] Event ID ${eventId} not found or error:`, eventError);
        return new Response(JSON.stringify({ error: 'Event not found or manager data missing.' }), { 
            status: 404, 
            headers: corsHeaders 
        });
    }

    if (eventData.is_active === false) {
        return new Response(JSON.stringify({ error: 'Este evento não está disponível para novas compras.' }), {
            status: 403,
            headers: corsHeaders,
        });
    }

    const { data: salesOpen, error: salesRpcError } = await supabaseService.rpc('event_accepts_new_sales', {
        p_event_id: eventId,
    });
    if (salesRpcError) {
        console.error('[create-payment-preference] event_accepts_new_sales:', salesRpcError);
        return new Response(
            JSON.stringify({ error: 'Não foi possível validar o evento. Tente novamente em instantes.' }),
            { status: 500, headers: corsHeaders },
        );
    }
    if (salesOpen !== true) {
        return new Response(
            JSON.stringify({ error: 'O prazo para compra de ingressos deste evento foi encerrado.' }),
            { status: 403, headers: corsHeaders },
        );
    }
    
    let managerUserId = eventData.created_by as string | null;
    if (!managerUserId && eventData.company_id) {
        console.warn(
          `[DEBUG] Event ${eventId} sem created_by. Tentando fallback por company_id=${eventData.company_id}.`,
        );
        const { data: companyManagerData, error: companyManagerError } = await supabaseService
          .from('user_companies')
          .select('user_id')
          .eq('company_id', eventData.company_id)
          .limit(1)
          .maybeSingle();

        if (companyManagerError) {
          console.error('[DEBUG] Erro ao buscar gestor por company_id:', companyManagerError);
        } else if (companyManagerData?.user_id) {
          managerUserId = companyManagerData.user_id as string;
          console.log(
            `[DEBUG] Fallback manager resolved via company_id. manager_user_id=${managerUserId}`,
          );
        } else {
          console.warn(
            `[DEBUG] Nenhum vínculo em user_companies para company_id=${eventData.company_id}.`,
          );
        }
    }

    if (!managerUserId) {
        console.error(
          `[DEBUG] Event ID ${eventId} sem gestor. created_by=${eventData.created_by ?? 'null'} company_id=${eventData.company_id ?? 'null'}.`,
        );
        return new Response(JSON.stringify({ error: 'Evento não possui um gestor associado. Contate o suporte.' }), {
            status: 400,
            headers: corsHeaders
        });
    }
    console.log(`[DEBUG] Event found. Manager ID: ${managerUserId}`);
    
    // 3. Mercado Pago Access Token (mesmo formato do outro projeto: via variável de ambiente)
    // IMPORTANTE: para este teste, não buscamos mais em payment_settings
    const mpAccessTokenRaw = Deno.env.get('PAYMENT_API_KEY_SECRET');
    if (!mpAccessTokenRaw || mpAccessTokenRaw.trim() === '') {
        console.error('[DEBUG ERROR] PAYMENT_API_KEY_SECRET not set or empty.');
        return new Response(JSON.stringify({ error: 'Payment service not configured (missing PAYMENT_API_KEY_SECRET).' }), {
            status: 500,
            headers: corsHeaders
        });
    }
    const mpAccessToken = mpAccessTokenRaw.trim();
    console.log(`[DEBUG] Access Token found (masked length: ${mpAccessToken.length})`);
    console.log(`[DEBUG] Access Token starts with: ${mpAccessToken.substring(0, 10)}...`);
    
    // 4. Reserve/Identify available wristband analytics records
    const analyticsIdsToReserve: string[] = [];
    
    for (const item of purchaseItems) {
        const { ticketTypeId, quantity } = item;
        
        // Fetch N records of analytics that are 'active' and not associated with a client
        const { data: availableAnalytics, error: fetchAnalyticsError } = await supabaseService
            .from('wristband_analytics')
            .select('id')
            .eq('wristband_id', ticketTypeId)
            .eq('status', 'active')
            .is('client_user_id', null)
            .limit(quantity);

        if (fetchAnalyticsError) throw fetchAnalyticsError;

        if (!availableAnalytics || availableAnalytics.length < quantity) {
            return new Response(JSON.stringify({ error: `Not enough tickets available for type ${ticketTypeId}. Available: ${availableAnalytics?.length || 0}. Requested: ${quantity}.` }), { 
                status: 409, 
                headers: corsHeaders 
            });
        }
        
        analyticsIdsToReserve.push(...availableAnalytics.map(a => a.id));
    }
    
    // 5. Insert pending transaction into receivables
    const { data: transactionData, error: insertTransactionError } = await supabaseService
        .from('receivables')
        .insert({
            client_user_id: clientUserId,
            manager_user_id: managerUserId,
            event_id: eventId,
            total_value: totalValue,
            status: 'pending',
            payment_status: 'pending',
            gross_amount: totalValue,
            wristband_analytics_ids: analyticsIdsToReserve, // IDs reservados
        })
        .select('id')
        .single();

    if (insertTransactionError) throw insertTransactionError;
    const transactionId = transactionData.id;
    
    // 6. Prepare MP Preference Items
    // IMPORTANTE: unit_price deve ser número, não string
    const mpItems = purchaseItems.map((item: any) => ({
        title: item.name || 'Ingresso Evento',
        unit_price: Number(item.price) || 0, // Garante que é número
        quantity: Number(item.quantity) || 0, // Garante que é número
        currency_id: 'BRL',
    })).filter(item => item.unit_price > 0 && item.quantity > 0); // Remove itens inválidos
    
    // 7. Obtém a URL base do projeto Supabase para construir as URLs de retorno e notificação
    // IMPORTANTE: Mercado Pago exige URLs públicas válidas (não localhost)
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    
    // Para notification_url, usa a URL completa da Edge Function
    const notificationUrl = `${supabaseUrl}/functions/v1/mercadopago-webhook`;
    
    const base = checkoutOrigin.replace(/\/$/, '');
    if (!base) {
      await supabaseService.from('receivables').delete().eq('id', transactionId);
      return new Response(
        JSON.stringify({
          error: 'SITE_URL ou clientOrigin inválido. Configure SITE_URL nas secrets da função e/ou envie clientOrigin do front.',
        }),
        { status: 400, headers: corsHeaders },
      );
    }

    const successUrl = `${base}/tickets?status=success&transaction_id=${transactionId}`;
    const pendingUrl = `${base}/tickets?status=pending&transaction_id=${transactionId}`;
    const failureUrl = `${base}/tickets?status=failure&transaction_id=${transactionId}`;

    console.log(`[DEBUG] Notification URL: ${notificationUrl}`);
    console.log(`[DEBUG] Success URL: ${successUrl}`);
    console.log(`[DEBUG] Supabase URL: ${supabaseUrl}`);

    // 8. Create MP Preference usando API REST diretamente (mais confiável que SDK)
    // Validação: Preferência deve ter pelo menos um item com preço válido
    if (!mpItems || mpItems.length === 0 || mpItems.some((item: any) => !item.unit_price || item.unit_price <= 0)) {
        await supabaseService.from('receivables').delete().eq('id', transactionId);
        return new Response(JSON.stringify({ error: 'Itens de pagamento inválidos. Verifique os preços.' }), { 
            status: 400, 
            headers: corsHeaders 
        });
    }

    // Sem auto_return: em várias contas MP o PolicyAgent bloqueia preferência quando back_urls não batem com a app ou com auto_return.
    const preferenceData: Record<string, unknown> = {
        items: mpItems,
        external_reference: transactionId,
        notification_url: notificationUrl,
        back_urls: {
            success: successUrl,
            pending: pendingUrl,
            failure: failureUrl,
        },
    };

    console.log(`[DEBUG] Creating MP preference with access token length: ${mpAccessToken.length}`);
    console.log(`[DEBUG] Preference data:`, JSON.stringify(preferenceData, null, 2));
    
    // Formato correto do header Authorization para Mercado Pago
    // IMPORTANTE: Token deve estar limpo (sem espaços) e no formato Bearer
    const cleanToken = mpAccessToken.trim();
    const authorizationHeader = `Bearer ${cleanToken}`;
    
    console.log(`[DEBUG] Authorization header length: ${authorizationHeader.length}`);
    console.log(`[DEBUG] Token prefix: ${cleanToken.substring(0, 15)}...`);
    
    const mpApiResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': authorizationHeader,
        },
        body: JSON.stringify(preferenceData),
    });

    if (!mpApiResponse.ok) {
        const errorText = await mpApiResponse.text();
        let errorMessage = 'Falha ao criar preferência de pagamento no Mercado Pago.';
        let mpCode: string | undefined;
        let mpBlockedBy: string | undefined;

        try {
            const errorJson = JSON.parse(errorText) as Record<string, unknown>;
            console.error(`[DEBUG] MP API Error (${mpApiResponse.status}):`, JSON.stringify(errorJson, null, 2));

            if (typeof errorJson.message === 'string') {
                errorMessage = errorJson.message;
            } else if (Array.isArray(errorJson.cause)) {
                errorMessage = (errorJson.cause as any[])
                    .map((c: any) => c.description || c.message)
                    .filter(Boolean)
                    .join(', ');
            }
            if (typeof errorJson.code === 'string') mpCode = errorJson.code;
            if (typeof errorJson.blocked_by === 'string') mpBlockedBy = errorJson.blocked_by;
        } catch (_e) {
            console.error(`[DEBUG] MP API Error (${mpApiResponse.status}):`, errorText);
        }

        const isPolicyBlock =
            mpApiResponse.status === 403 &&
            (mpCode === 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES' || mpBlockedBy === 'PolicyAgent');

        const hint = isPolicyBlock
            ? 'Mercado Pago (PolicyAgent) bloqueou o checkout. Confira: (1) por padrão, back_urls usam SITE_URL; valide SITE_URL https público da mesma aplicação cadastrada no MP. (2) Se optar por origem dinâmica, ative USE_DYNAMIC_BACK_URLS=true e preencha CHECKOUT_PUBLIC_ORIGINS. (3) No painel MP, libere o(s) domínio(s) nas URLs de retorno. (4) PAYMENT_API_KEY_SECRET de produção válido.'
            : mpApiResponse.status === 401 || mpApiResponse.status === 403
            ? 'Token do Mercado Pago recusado. Verifique PAYMENT_API_KEY_SECRET (produção vs teste) e se o token não expirou.'
            : undefined;

        await supabaseService.from('receivables').delete().eq('id', transactionId);

        const httpStatus = isPolicyBlock || mpApiResponse.status === 403 ? 403 : 502;

        return new Response(
            JSON.stringify({
                error: errorMessage,
                mpCode,
                mpBlockedBy,
                mpHttpStatus: mpApiResponse.status,
                backUrlBaseUsed: base,
                siteUrlEnv,
                dynamicBackUrlsEnabled: (Deno.env.get('USE_DYNAMIC_BACK_URLS') ?? '').trim() === 'true',
                hint,
            }),
            {
                status: httpStatus,
                headers: corsHeaders,
            },
        );
    }

    const mpResponse = await mpApiResponse.json();
    console.log(`[DEBUG] MP response received. ID: ${mpResponse.id}, Init point: ${mpResponse.init_point}`);
    
    if (!mpResponse.init_point) {
        // Se falhar, reverter a transação pendente
        await supabaseService.from('receivables').delete().eq('id', transactionId);
        return new Response(JSON.stringify({ error: 'URL de pagamento não foi gerada pelo Mercado Pago. Verifique as configurações.' }), { 
            status: 500, 
            headers: corsHeaders 
        });
    }

    // 9. Update receivables with payment gateway ID (MP preference ID)
    await supabaseService
        .from('receivables')
        .update({
            payment_gateway_id: mpResponse.id,
            mp_preference_id: mpResponse.id,
            payment_status: 'pending',
        })
        .eq('id', transactionId);

    // 11. Return checkout URL
    return new Response(JSON.stringify({ 
        message: 'Payment preference created successfully.',
        checkoutUrl: mpResponse.init_point,
        transactionId: transactionId,
    }), { 
        status: 200, 
        headers: corsHeaders 
    });

  } catch (error) {
    console.error('Edge Function Error:', error);
    // Em caso de erro, tentamos reverter a transação pendente se ela existir
    // (Lógica de reversão mais robusta seria necessária em produção)
    return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), { 
      status: 500, 
      headers: corsHeaders 
    });
  }
});
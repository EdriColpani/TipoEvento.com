import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

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
    const body = await req.json();
    const { eventId, purchaseItems } = body; // purchaseItems: [{ ticketTypeId, quantity, price, name }]
    
    const SITE_URL = Deno.env.get('SITE_URL') ?? '';
    console.log(`[DEBUG] Received request for Event ID: ${eventId}. Site URL: ${SITE_URL}`);

    if (!eventId || !purchaseItems || purchaseItems.length === 0) {
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
        .select('created_by')
        .eq('id', eventId)
        .single();

    if (eventError || !eventData) {
        console.error(`[DEBUG] Event ID ${eventId} not found or error:`, eventError);
        return new Response(JSON.stringify({ error: 'Event not found or manager data missing.' }), { 
            status: 404, 
            headers: corsHeaders 
        });
    }
    
    const managerUserId = eventData.created_by;
    
    if (!managerUserId) {
        console.error(`[DEBUG] Event ID ${eventId} has no created_by (manager) associated.`);
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
    
    // Para back_urls, usa URLs do próprio Supabase (o Mercado Pago redireciona para lá)
    // NOTA: Se sua aplicação frontend estiver em outro domínio, substitua aqui
    const successUrl = `${SITE_URL}/tickets?status=success&transaction_id=${transactionId}`;
    const pendingUrl = `${SITE_URL}/tickets?status=pending&transaction_id=${transactionId}`;
    const failureUrl = `${SITE_URL}/tickets?status=failure&transaction_id=${transactionId}`;
     
    console.log(`[DEBUG] Notification URL: ${notificationUrl}`);
    console.log(`[DEBUG] Success URL: ${successUrl}`);
    console.log(`[DEBUG] Supabase URL: ${supabaseUrl}`);
    console.log(`[DEBUG] SITE_URL: ${SITE_URL}`);

    // 8. Create MP Preference usando API REST diretamente (mais confiável que SDK)
    // Validação: Preferência deve ter pelo menos um item com preço válido
    if (!mpItems || mpItems.length === 0 || mpItems.some((item: any) => !item.unit_price || item.unit_price <= 0)) {
        await supabaseService.from('receivables').delete().eq('id', transactionId);
        return new Response(JSON.stringify({ error: 'Itens de pagamento inválidos. Verifique os preços.' }), { 
            status: 400, 
            headers: corsHeaders 
        });
    }

    const preferenceData = {
        items: mpItems,
        external_reference: transactionId,
        notification_url: notificationUrl, 
        back_urls: {
            success: successUrl,
            pending: pendingUrl,
            failure: failureUrl,
        },
        auto_return: "approved",
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
        
        try {
            const errorJson = JSON.parse(errorText);
            console.error(`[DEBUG] MP API Error (${mpApiResponse.status}):`, JSON.stringify(errorJson, null, 2));
            
            if (errorJson.message) {
                errorMessage = errorJson.message;
            } else if (errorJson.cause && Array.isArray(errorJson.cause)) {
                errorMessage = errorJson.cause.map((c: any) => c.description || c.message).join(', ');
            } else if (typeof errorJson === 'string') {
                errorMessage = errorJson;
            }
        } catch (e) {
            console.error(`[DEBUG] MP API Error (${mpApiResponse.status}):`, errorText);
        }
        
        // Se falhar, reverter a transação pendente
        await supabaseService.from('receivables').delete().eq('id', transactionId);
        return new Response(JSON.stringify({ 
            error: errorMessage,
            details: errorText,
            statusCode: mpApiResponse.status
        }), { 
            status: 500, 
            headers: corsHeaders 
        });
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
        .update({ payment_gateway_id: mpResponse.id })
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
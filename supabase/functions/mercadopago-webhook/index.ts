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
  
  // Webhooks do Mercado Pago podem enviar dados via query params OU corpo JSON
  const url = new URL(req.url);
  const topic = url.searchParams.get('topic');
  const idFromQuery = url.searchParams.get('id'); // ID da notificação ou do recurso (query)
  const type = url.searchParams.get('type'); // Alias para topic

  // Tentar também ler o corpo JSON (alguns webhooks do MP enviam data.id no body)
  let body: any = null;
  try {
    if (req.method !== 'OPTIONS') {
      body = await req.json().catch(() => null);
    }
  } catch {
    body = null;
  }

  const idFromBody = body?.data?.id || body?.id || null;
  const notificationType = topic || type || body?.type || body?.action || null;

  if (!notificationType) {
    return new Response(JSON.stringify({ error: 'Missing notification type' }), { status: 400, headers: corsHeaders });
  }
  
  // 1. Determinar o tipo de notificação e ID do recurso
  const resourceId = idFromQuery || idFromBody;

  if (notificationType !== 'payment' || !resourceId) {
    console.log(`[MP Webhook] Ignoring notification type: ${notificationType} or missing resource ID. Query id: ${idFromQuery}, Body id: ${idFromBody}`);
    return new Response(JSON.stringify({ message: 'Notification received, but ignored.' }), { status: 200, headers: corsHeaders });
  }

  try {
    // 2. Obter o access token do Mercado Pago das Secrets (PAYMENT_API_KEY_SECRET)
    const mpAccessTokenRaw = Deno.env.get('PAYMENT_API_KEY_SECRET');
    if (!mpAccessTokenRaw || mpAccessTokenRaw.trim() === '') {
        console.error('[MP Webhook] ERROR: PAYMENT_API_KEY_SECRET not set or empty.');
        return new Response(JSON.stringify({ error: 'Payment service not configured (missing PAYMENT_API_KEY_SECRET).' }), { status: 500, headers: corsHeaders });
    }
    const mpAccessToken = mpAccessTokenRaw.trim();
    console.log(`[MP Webhook] Access Token found (masked length: ${mpAccessToken.length})`);
    console.log(`[MP Webhook] Access Token starts with: ${mpAccessToken.substring(0, 10)}...`);

    // 3. Chamar a API do Mercado Pago para obter o status real do pagamento
    console.log(`[MP Webhook] Fetching payment details for resource ID: ${resourceId}`);
    const mpPaymentApiResponse = await fetch(`https://api.mercadopago.com/v1/payments/${resourceId}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${mpAccessToken}`,
            'Content-Type': 'application/json',
        },
    });

    if (!mpPaymentApiResponse.ok) {
        const errorText = await mpPaymentApiResponse.text();
        console.error(`[MP Webhook] Mercado Pago API error fetching payment (${mpPaymentApiResponse.status}):`, errorText);
        return new Response(JSON.stringify({ error: 'Failed to fetch payment details from Mercado Pago.' }), { status: 500, headers: corsHeaders });
    }

    const mpPaymentData = await mpPaymentApiResponse.json();
    const paymentStatus = mpPaymentData.status; // Status real do pagamento
    const paymentStatusDetail = mpPaymentData.status_detail || null; // Detalhes adicionais do status
    console.log(`[MP Webhook] Payment status from Mercado Pago API: ${paymentStatus}`);
    console.log(`[MP Webhook] Payment status_detail: ${paymentStatusDetail}`);
    console.log(`[MP Webhook] Payment ID: ${mpPaymentData.id}`);
    console.log(`[MP Webhook] Payment operation_type: ${mpPaymentData.operation_type || 'N/A'}`);
    console.log(`[MP Webhook] Full payment data (truncated):`, JSON.stringify({
        id: mpPaymentData.id,
        status: mpPaymentData.status,
        status_detail: mpPaymentData.status_detail,
        external_reference: mpPaymentData.external_reference,
        transaction_amount: mpPaymentData.transaction_amount,
        date_approved: mpPaymentData.date_approved,
    }, null, 2));

    // 4. Usar o external_reference do pagamento para localizar a transação em 'receivables'
    // No create-payment-preference, definimos external_reference = transactionId (id do receivable)
    const externalReference = mpPaymentData.external_reference as string | null;
    console.log(`[MP Webhook] Payment external_reference: ${externalReference}`);
    
    if (!externalReference) {
        console.error('[MP Webhook] ERROR: Payment external_reference not found. Cannot link to receivables transaction.');
        console.error('[MP Webhook] Full payment data keys:', Object.keys(mpPaymentData));
        return new Response(JSON.stringify({ error: 'Payment external_reference missing. Cannot link transaction.' }), { status: 500, headers: corsHeaders });
    }

    const transactionId = externalReference;
    console.log(`[MP Webhook] Looking for receivable with transaction ID: ${transactionId}`);
    console.log(`[MP Webhook] Payment ID (resourceId): ${resourceId}`);

    // 5. Buscar a transação na tabela 'receivables' usando o transactionId (external_reference)
    // Primeiro, tentar encontrar com status 'pending'
    let { data: receivable, error: fetchReceivableError } = await supabaseService
        .from('receivables')
        .select('id, client_user_id, wristband_analytics_ids, manager_user_id, event_id, total_value, status, payment_gateway_id')
        .eq('id', transactionId)
        .eq('status', 'pending')
        .maybeSingle();

    // Se não encontrou com status 'pending', buscar sem filtro de status
    if (!receivable) {
        console.log(`[MP Webhook] Receivable not found with status 'pending', searching without status filter...`);
        const { data: receivableAnyStatus, error: fetchAnyStatusError } = await supabaseService
            .from('receivables')
            .select('id, client_user_id, wristband_analytics_ids, manager_user_id, event_id, total_value, status, payment_gateway_id')
            .eq('id', transactionId)
            .maybeSingle();
        
        if (receivableAnyStatus) {
            console.log(`[MP Webhook] Found receivable with status: ${receivableAnyStatus.status}, payment_gateway_id: ${receivableAnyStatus.payment_gateway_id}`);
            if (receivableAnyStatus.status === 'paid') {
                console.log(`[MP Webhook] Receivable already processed (status: paid). Ignoring notification.`);
                return new Response(JSON.stringify({ message: 'Receivable already processed.' }), { status: 200, headers: corsHeaders });
            }
            // Se está em outro status (ex: 'failed'), vamos processar mesmo assim se o pagamento foi aprovado
            receivable = receivableAnyStatus;
        } else {
            // Última tentativa: buscar pelo payment_gateway_id (ID da preferência do MP)
            // O payment_gateway_id armazena o ID da preferência, não o ID do pagamento
            // Mas podemos tentar buscar pelo order.id do pagamento (que referencia a preferência)
            const preferenceId = mpPaymentData.order?.id || mpPaymentData.preference_id || null;
            console.log(`[MP Webhook] Receivable not found by transaction ID. Trying to find by preference ID...`);
            console.log(`[MP Webhook] Payment order.id: ${preferenceId || 'N/A'}`);
            console.log(`[MP Webhook] Payment preference_id: ${mpPaymentData.preference_id || 'N/A'}`);
            
            if (preferenceId) {
                const { data: receivableByGatewayId, error: fetchByGatewayError } = await supabaseService
                    .from('receivables')
                    .select('id, client_user_id, wristband_analytics_ids, manager_user_id, event_id, total_value, status, payment_gateway_id')
                    .eq('payment_gateway_id', preferenceId)
                    .maybeSingle();
                
                if (receivableByGatewayId) {
                    console.log(`[MP Webhook] Found receivable by preference ID (payment_gateway_id): ${receivableByGatewayId.id}, status: ${receivableByGatewayId.status}`);
                    if (receivableByGatewayId.status === 'paid') {
                        console.log(`[MP Webhook] Receivable already processed. Ignoring notification.`);
                        return new Response(JSON.stringify({ message: 'Receivable already processed.' }), { status: 200, headers: corsHeaders });
                    }
                    receivable = receivableByGatewayId;
                } else {
                    console.error(`[MP Webhook] CRITICAL: Receivable not found by transaction ID (${transactionId}) or preference ID (${preferenceId}).`);
                    console.error(`[MP Webhook] Available payment data:`, JSON.stringify({
                        external_reference: externalReference,
                        order_id: preferenceId,
                        payment_id: resourceId,
                    }, null, 2));
                    return new Response(JSON.stringify({ message: 'Receivable not found in database.' }), { status: 200, headers: corsHeaders });
                }
            } else {
                console.error(`[MP Webhook] CRITICAL: Receivable not found by transaction ID (${transactionId}) and no preference ID available.`);
                console.error(`[MP Webhook] This suggests the receivable was not created correctly or the external_reference is wrong.`);
                return new Response(JSON.stringify({ message: 'Receivable not found in database.' }), { status: 200, headers: corsHeaders });
            }
        }
    }

    if (fetchReceivableError && fetchReceivableError.code !== 'PGRST116') {
        console.error(`[MP Webhook] Error fetching receivable:`, fetchReceivableError);
        return new Response(JSON.stringify({ error: 'Database error fetching receivable.' }), { status: 500, headers: corsHeaders });
    }
    
    // Verificar se o receivable foi encontrado
    if (!receivable) {
        console.error(`[MP Webhook] CRITICAL: Receivable not found after all search attempts. Transaction ID: ${transactionId}, Payment Gateway ID: ${resourceId}`);
        console.error(`[MP Webhook] This is a critical error. The receivable should exist before payment processing.`);
        return new Response(JSON.stringify({ error: 'Receivable not found in database. Cannot process payment.' }), { status: 500, headers: corsHeaders });
    }
    
    // Atualizar transactionId para o ID real do receivable encontrado (caso tenha sido encontrado por payment_gateway_id)
    const finalTransactionId = receivable.id;
    console.log(`[MP Webhook] Successfully found receivable: ${finalTransactionId}, current status: ${receivable.status}`);

    const clientUserId = receivable.client_user_id;
    const analyticsIds = receivable.wristband_analytics_ids;
    const managerUserId = receivable.manager_user_id;
    const eventId = receivable.event_id;
    const totalValue = receivable.total_value;

    // Validações adicionais para os novos campos
    if (!eventId || !totalValue) {
        console.error(`[MP Webhook] Critical Error: Receivable ${finalTransactionId} missing event_id or total_value.`);
        return new Response(JSON.stringify({ error: 'Transaction data incomplete.' }), { status: 500, headers: corsHeaders });
    }

    // Verificar se o pagamento foi aprovado/autorizado
    // O Mercado Pago pode retornar diferentes status para pagamentos bem-sucedidos:
    // - 'approved': Pagamento aprovado
    // - 'authorized': Pagamento autorizado (cartão de crédito)
    // - 'in_process' com date_approved: Pagamento em processamento mas já aprovado
    const hasDateApproved = mpPaymentData.date_approved !== null && mpPaymentData.date_approved !== undefined;
    const isPaymentApproved = paymentStatus === 'approved' || 
                              paymentStatus === 'authorized' || 
                              (paymentStatus === 'in_process' && hasDateApproved);
    
    console.log(`[MP Webhook] Payment status evaluation:`);
    console.log(`  - Status: ${paymentStatus}`);
    console.log(`  - Status Detail: ${paymentStatusDetail}`);
    console.log(`  - Date Approved: ${mpPaymentData.date_approved || 'N/A'}`);
    console.log(`  - Has Date Approved: ${hasDateApproved}`);
    console.log(`  - Is Payment Approved: ${isPaymentApproved}`);
    
    if (isPaymentApproved) {
        // 6. Atualizar status da transação para 'paid'
        console.log(`[MP Webhook] Updating receivable ${finalTransactionId} status to 'paid'...`);
        const { error: updateReceivableError, data: updateReceivableData } = await supabaseService
            .from('receivables')
            .update({ status: 'paid' })
            .eq('id', finalTransactionId)
            .select('id, status');

        if (updateReceivableError) {
            console.error(`[MP Webhook] CRITICAL: Failed to update receivable status:`, updateReceivableError);
            throw updateReceivableError;
        }
        
        if (!updateReceivableData || updateReceivableData.length === 0) {
            console.error(`[MP Webhook] CRITICAL: Receivable ${finalTransactionId} not found for status update.`);
            throw new Error(`Receivable ${finalTransactionId} not found for status update.`);
        }
        
        console.log(`[MP Webhook] Successfully updated receivable ${finalTransactionId} status to 'paid'`);

        // 5. Buscar o percentual de comissão aplicado ao evento e company_id
        const { data: eventData, error: fetchEventError } = await supabaseService
            .from('events')
            .select('applied_percentage, company_id')
            .eq('id', eventId)
            .single();
        
        if (fetchEventError || !eventData) {
            console.error(`[MP Webhook] Critical Error: Event ${eventId} not found or missing applied_percentage.`, fetchEventError);
            throw new Error(`Event ${eventId} data incomplete for financial split.`);
        }

        const appliedPercentage = eventData.applied_percentage;
        const companyId = eventData.company_id;
        
        // Validação do percentual de comissão
        if (!appliedPercentage || appliedPercentage < 0 || appliedPercentage > 100) {
            console.error(`[MP Webhook] Critical Error: Invalid applied_percentage (${appliedPercentage}) for event ${eventId}.`);
            throw new Error(`Invalid commission percentage for event ${eventId}.`);
        }

        // 6. Calcular valores: comissão da plataforma e valor líquido do organizador
        const platformAmount = totalValue * (appliedPercentage / 100);
        const managerAmount = totalValue - platformAmount;
        
        console.log(`[MP Webhook] Financial Calculation for transaction ${finalTransactionId}:`);
        console.log(`  - Total Value: R$ ${totalValue.toFixed(2)}`);
        console.log(`  - Applied Percentage: ${appliedPercentage}%`);
        console.log(`  - Platform Commission: R$ ${platformAmount.toFixed(2)}`);
        console.log(`  - Manager Net Amount: R$ ${managerAmount.toFixed(2)}`);
        console.log(`  - Company ID: ${companyId}`);

        // 7. Registrar a divisão financeira na tabela financial_splits
        // IMPORTANTE: Gravar 2 registros separados conforme regra de negócio:
        // a) Um registro para o valor líquido do organizador (manager_amount preenchido, platform_amount = 0)
        // b) Um registro para a comissão da plataforma (platform_amount preenchido, manager_amount = 0)
        // Usando split_type como flag para identificar claramente cada registro
        
        // Preparar os 2 registros de financial_splits conforme regra de negócio
        // IMPORTANTE: A identificação de qual registro é comissão é feita por:
        // - Registro com platform_amount > 0 e manager_amount = 0 → Comissão do sistema
        // - Registro com manager_amount > 0 e platform_amount = 0 → Valor líquido do organizador
        const financialSplitsToInsert = [
            // Registro 1: Valor líquido do organizador (manager)
            {
                transaction_id: finalTransactionId,
                event_id: eventId,
                manager_user_id: managerUserId,
                platform_amount: 0, // Zero identifica que este é o valor líquido do organizador
                manager_amount: managerAmount, // Valor líquido do organizador
                total_amount: totalValue,
                applied_percentage: appliedPercentage,
            },
            // Registro 2: Comissão da plataforma (sistema)
            {
                transaction_id: finalTransactionId,
                event_id: eventId,
                manager_user_id: managerUserId,
                platform_amount: platformAmount, // Valor > 0 identifica que este é a comissão do sistema
                manager_amount: 0, // Zero identifica que este é a comissão
                total_amount: totalValue,
                applied_percentage: appliedPercentage,
            }
        ];

        // Verificar se os financial_splits já foram inseridos (idempotência)
        const { data: existingSplits, error: checkSplitsError } = await supabaseService
            .from('financial_splits')
            .select('id')
            .eq('transaction_id', finalTransactionId)
            .limit(1);
        
        if (checkSplitsError) {
            console.error(`[MP Webhook] Error checking existing financial splits:`, checkSplitsError);
            throw new Error(`Failed to check existing financial splits: ${checkSplitsError.message}`);
        }
        
        if (existingSplits && existingSplits.length > 0) {
            console.log(`[MP Webhook] Financial splits already exist for transaction ${finalTransactionId}. Skipping insertion to avoid duplicates.`);
        } else {
            // Inserir os 2 registros de forma atômica (se um falhar, ambos falham)
            // Usando transação implícita do Supabase (insert em lote)
            console.log(`[MP Webhook] Inserting financial splits for transaction ${finalTransactionId}...`);
            const { error: insertSplitError } = await supabaseService
                .from('financial_splits')
                .insert(financialSplitsToInsert);

            if (insertSplitError) {
                console.error(`[MP Webhook] Critical Error: Failed to insert financial splits for transaction ${finalTransactionId}:`, insertSplitError);
                // Se a inserção falhar, reverter a atualização do receivable para manter consistência
                await supabaseService
                    .from('receivables')
                    .update({ status: 'pending' })
                    .eq('id', finalTransactionId);
                throw new Error(`Failed to record financial splits: ${insertSplitError.message}`);
            }
        
        console.log(`[MP Webhook] Successfully inserted 2 financial split records for transaction ${finalTransactionId}:`);
        console.log(`  - Manager Net Amount Record: R$ ${managerAmount.toFixed(2)}`);
        console.log(`  - Platform Commission Record: R$ ${platformAmount.toFixed(2)}`);

        // 7. Atualizar wristband analytics: associar cliente e marcar como 'used'/'purchase'
        // IMPORTANTE: Buscar TODOS os campos obrigatórios para evitar erro de NOT NULL constraint
        const { data: analyticsToUpdate, error: fetchUpdateError } = await supabaseService
            .from('wristband_analytics')
            .select('id, wristband_id, code_wristbands, sequential_number, status, event_type, event_data')
            .in('id', analyticsIds);
            
        if (fetchUpdateError) {
            console.error("CRITICAL: Failed to fetch analytics records for update:", fetchUpdateError);
            throw new Error("Payment approved, but failed to retrieve ticket details for assignment.");
        }
        
        if (!analyticsToUpdate || analyticsToUpdate.length === 0) {
            console.error(`CRITICAL: No analytics records found for IDs: ${analyticsIds.join(', ')}`);
            throw new Error("Payment approved, but no analytics records found for assignment.");
        }
        
        // Prepara batch update para analytics records
        // IMPORTANTE: Incluir TODOS os campos obrigatórios (NOT NULL) para evitar erro 23502
        const updates = analyticsToUpdate.map(record => {
            // Preservar event_data existente e adicionar dados da compra
            const existingEventData = record.event_data || {};
            const purchaseEventData = {
                ...existingEventData,
                    purchase_date: new Date().toISOString(),
                    client_id: clientUserId,
                    transaction_id: finalTransactionId,
                platform_commission_percentage: appliedPercentage,
                platform_commission_amount: platformAmount,
                manager_net_amount: managerAmount,
            };
            
            return {
                id: record.id,
                wristband_id: record.wristband_id, // Campo obrigatório
                code_wristbands: record.code_wristbands, // Campo obrigatório
                sequential_number: record.sequential_number, // Campo obrigatório (pode ser null, mas incluímos)
                client_user_id: clientUserId,
                status: 'used', 
                event_type: 'purchase',
                event_data: purchaseEventData,
            };
        });

        // Usar update em vez de upsert para garantir que apenas os registros existentes sejam atualizados
        // E fazer update individual para cada registro para garantir atomicidade
        for (const update of updates) {
            const { error: updateError } = await supabaseService
                .from('wristband_analytics')
                .update({
                    client_user_id: update.client_user_id,
                    status: update.status,
                    event_type: update.event_type,
                    event_data: update.event_data,
                })
                .eq('id', update.id);
            
            if (updateError) {
                console.error(`CRITICAL: Failed to update wristband analytics record ${update.id}:`, updateError);
                throw new Error(`Failed to update wristband analytics: ${updateError.message}`);
            }
        }
        
        console.log(`[MP Webhook] Successfully updated ${updates.length} wristband analytics records for transaction ${finalTransactionId}`);
        
        // Log final de confirmação
        console.log(`[MP Webhook] ✅ COMPLETE: Transaction ${finalTransactionId} fully processed:`);
        console.log(`  ✅ Receivable status updated to 'paid'`);
        console.log(`  ✅ Financial splits recorded (2 records)`);
        console.log(`  ✅ Wristband analytics updated (${updates.length} records)`);
        
        return new Response(JSON.stringify({ 
            message: 'Payment approved, financial split recorded, and tickets assigned.',
            transaction_id: finalTransactionId,
            status: 'paid'
        }), { status: 200, headers: corsHeaders });

    } else if (paymentStatus === 'rejected' || paymentStatus === 'cancelled') {
        // 4. Atualizar status da transação para 'failed'
        console.log(`[MP Webhook] Payment ${paymentStatus}. Updating receivable ${finalTransactionId} to 'failed'...`);
        const { error: updateReceivableError } = await supabaseService
            .from('receivables')
            .update({ status: 'failed' })
            .eq('id', finalTransactionId);

        if (updateReceivableError) {
            console.error(`[MP Webhook] CRITICAL: Failed to update receivable to 'failed':`, updateReceivableError);
            throw updateReceivableError;
        }
        
        console.log(`[MP Webhook] Receivable ${finalTransactionId} marked as 'failed'`);
        // NOTA: Não precisamos reverter o status 'active' dos analytics, pois eles nunca foram alterados.
        
        return new Response(JSON.stringify({ message: `Payment ${paymentStatus}. Transaction marked as failed.` }), { status: 200, headers: corsHeaders });
    } else {
        // Status não tratado (pending, in_process sem date_approved, etc.)
        console.log(`[MP Webhook] Payment status '${paymentStatus}' not processed. Transaction ${finalTransactionId} remains in current status.`);
        console.log(`[MP Webhook] Payment will be processed when status changes to 'approved' or 'authorized'.`);
        return new Response(JSON.stringify({ 
            message: `Notification processed. Payment status: ${paymentStatus}. Transaction remains pending.`,
            payment_status: paymentStatus
        }), { status: 200, headers: corsHeaders });
    }

  } catch (error) {
    console.error('Edge Function Error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), { 
      status: 500, 
      headers: corsHeaders 
    });
  }
});
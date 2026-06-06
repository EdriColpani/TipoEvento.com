import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { resolveWebhookPayment } from './mp-ticket-payment.ts';
import { extractMpPaymentFinancials, resolveSplitAmounts } from './mp-payment-financials.ts';

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

async function logCheckoutOps(params: {
  eventId: string | null | undefined;
  correlationId: string;
  operation: string;
  status?: string;
  details?: Record<string, unknown>;
}) {
  if (!params.eventId) return;
  try {
    await supabaseService.rpc('log_checkout_ops_event', {
      p_event_id: params.eventId,
      p_correlation_id: params.correlationId,
      p_operation: params.operation,
      p_status: params.status ?? 'ok',
      p_duration_ms: null,
      p_details: params.details ?? {},
    });
  } catch (err) {
    console.warn('[checkout-ops-log]', err);
  }
}

async function logPaymentEvent(params: {
  transactionId: string;
  source: 'webhook' | 'system';
  paymentStatus?: string | null;
  receivableStatus?: string | null;
  paymentStatusDetail?: string | null;
  mpPaymentId?: string | null;
  mpPreferenceId?: string | null;
  payload?: Record<string, unknown>;
}) {
  const { error } = await supabaseService
    .from('payment_events')
    .insert({
      transaction_id: params.transactionId,
      source: params.source,
      payment_status: params.paymentStatus ?? null,
      receivable_status: params.receivableStatus ?? null,
      payment_status_detail: params.paymentStatusDetail ?? null,
      mp_payment_id: params.mpPaymentId ?? null,
      mp_preference_id: params.mpPreferenceId ?? null,
      payload: params.payload ?? null,
    });

  if (error) {
    console.error('[MP Webhook] Failed to write payment_events log:', error);
  }
}

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
  } catch (_error) {
    body = null;
  }

  const idFromBody = body?.data?.id || body?.id || null;
  const rawNotificationType = topic || type || body?.type || body?.action || null;
  const normalizedNotificationType =
    typeof rawNotificationType === 'string' && rawNotificationType.toLowerCase().startsWith('payment')
      ? 'payment'
      : rawNotificationType;

  const internalJobIdHeader = req.headers.get('X-Internal-Webhook-Job');
  const workerTokenHeaderEarly = (req.headers.get('X-Webhook-Worker-Token') ?? '').trim();
  const expectedWorkerTokenEarly = (Deno.env.get('WEBHOOK_WORKER_TOKEN') ?? 'internal').trim();
  const isInternalJobRequest = body?._internalJob === true
    && body?.payment
    && internalJobIdHeader
    && workerTokenHeaderEarly === expectedWorkerTokenEarly;

  if (!isInternalJobRequest) {
    if (!normalizedNotificationType) {
      if (idFromBody) {
        console.warn('[MP Webhook] notification type ausente; inferindo tipo "payment" via data.id.');
      } else {
        return new Response(JSON.stringify({ error: 'Missing notification type' }), { status: 400, headers: corsHeaders });
      }
    }

    const resourceIdCheck = idFromQuery || idFromBody;
    const finalTypeCheck = normalizedNotificationType || (idFromBody ? 'payment' : null);

    if (finalTypeCheck !== 'payment' || !resourceIdCheck) {
      console.log(`[MP Webhook] Ignoring notification type: ${String(finalTypeCheck)} (raw=${String(rawNotificationType)}) or missing resource ID.`);
      return new Response(JSON.stringify({ message: 'Notification received, but ignored.' }), { status: 200, headers: corsHeaders });
    }
  }
  
  // 1. Determinar o tipo de notificação e ID do recurso
  const resourceId = isInternalJobRequest
    ? String((body.payment as Record<string, unknown>)?.id ?? '')
    : (idFromQuery || idFromBody);
  const finalNotificationType = isInternalJobRequest
    ? 'payment'
    : (normalizedNotificationType || (idFromBody ? 'payment' : null));

  if (!isInternalJobRequest && (finalNotificationType !== 'payment' || !resourceId)) {
    console.log(`[MP Webhook] Ignoring notification type: ${String(finalNotificationType)} (raw=${String(rawNotificationType)}) or missing resource ID. Query id: ${idFromQuery}, Body id: ${idFromBody}`);
    return new Response(JSON.stringify({ message: 'Notification received, but ignored.' }), { status: 200, headers: corsHeaders });
  }

  try {
    const internalJobId = internalJobIdHeader;
    const workerTokenHeader = workerTokenHeaderEarly;
    const expectedWorkerToken = expectedWorkerTokenEarly;
    const isInternalJob = isInternalJobRequest;

    let mpPaymentData: Record<string, any>;

    if (isInternalJob) {
      mpPaymentData = body.payment as Record<string, any>;
      console.log(`[MP Webhook] Internal job processing ${internalJobId}`);
    } else {
      const paymentLookup = await resolveWebhookPayment(supabaseService, String(resourceId));
      if (!paymentLookup.ok) {
        console.error(`[MP Webhook] Mercado Pago API error (${paymentLookup.status}):`, paymentLookup.text);
        return new Response(JSON.stringify({ error: 'Failed to fetch payment details from Mercado Pago.' }), { status: 500, headers: corsHeaders });
      }
      mpPaymentData = paymentLookup.data as Record<string, any>;
    }

    const paymentStatus = mpPaymentData.status; // Status real do pagamento
    const paymentStatusDetail = mpPaymentData.status_detail || null; // Detalhes adicionais do status
    const mpPaymentId = mpPaymentData.id ? String(mpPaymentData.id) : null;
    const mpPreferenceId = mpPaymentData.order?.id
      ? String(mpPaymentData.order.id)
      : (mpPaymentData.preference_id ? String(mpPaymentData.preference_id) : null);
    const mpFinancials = extractMpPaymentFinancials(mpPaymentData);
    const grossAmount = mpFinancials.grossAmount;
    const mpFeeAmount = mpFinancials.mpFeeAmount;
    const netAmountAfterMp = mpFinancials.collectorNetAmount;
    const platformFeeAmount = mpFinancials.platformFeeAmount;
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

    const LISTING_CHARGE_PREFIX = 'listing_charge:';
    const CREDIT_TOPUP_PREFIX = 'credit_topup:';

    if (externalReference.startsWith(CREDIT_TOPUP_PREFIX)) {
        const topupOrderId = externalReference.slice(CREDIT_TOPUP_PREFIX.length);
        console.log(`[MP Webhook] Credit top-up: ${topupOrderId}, status=${paymentStatus}`);

        if (paymentStatus === 'approved' || paymentStatus === 'authorized') {
            const { data: settleData, error: settleErr } = await supabaseService.rpc('credit_topup_settle', {
                p_topup_order_id: topupOrderId,
                p_mp_payment_id: mpPaymentId,
                p_mp_fee_amount: mpFeeAmount ?? 0,
                p_net_cash_received: netAmountAfterMp,
                p_payment_status: paymentStatus,
            });
            if (settleErr) {
                console.error('[MP Webhook] credit_topup_settle:', settleErr);
                return new Response(JSON.stringify({ error: settleErr.message }), {
                    status: 500,
                    headers: corsHeaders,
                });
            }
            console.log('[MP Webhook] credit_topup_settle result:', settleData);
        } else {
            await supabaseService
                .from('credit_topup_orders')
                .update({ status: 'failed', updated_at: new Date().toISOString() })
                .eq('id', topupOrderId)
                .eq('status', 'pending');
        }

        return new Response(JSON.stringify({ received: true, type: 'credit_topup' }), {
            status: 200,
            headers: corsHeaders,
        });
    }

    if (externalReference.startsWith(LISTING_CHARGE_PREFIX)) {
        const listingChargeId = externalReference.slice(LISTING_CHARGE_PREFIX.length);
        console.log(`[MP Webhook] Listing monthly charge payment: ${listingChargeId}, status=${paymentStatus}`);

        if (paymentStatus === 'approved' || paymentStatus === 'authorized') {
            const { error: completeErr } = await supabaseService.rpc(
                'complete_listing_monthly_charge_payment',
                {
                    p_charge_id: listingChargeId,
                    p_mp_payment_id: mpPaymentId,
                    p_mp_fee_amount: mpFeeAmount ?? 0,
                    p_net_received_amount: netAmountAfterMp ?? null,
                },
            );
            if (completeErr) {
                console.error('[MP Webhook] complete_listing_monthly_charge_payment:', completeErr);
                return new Response(JSON.stringify({ error: completeErr.message }), {
                    status: 500,
                    headers: corsHeaders,
                });
            }
        }

        return new Response(JSON.stringify({ received: true, type: 'listing_monthly_charge' }), {
            status: 200,
            headers: corsHeaders,
        });
    }

    const TICKET_INACTIVITY_CHARGE_PREFIX = 'ticket_inactivity_charge:';
    if (externalReference.startsWith(TICKET_INACTIVITY_CHARGE_PREFIX)) {
        const inactivityChargeId = externalReference.slice(TICKET_INACTIVITY_CHARGE_PREFIX.length);
        console.log(`[MP Webhook] Ticket inactivity charge payment: ${inactivityChargeId}, status=${paymentStatus}`);

        if (paymentStatus === 'approved' || paymentStatus === 'authorized') {
            const { error: completeErr } = await supabaseService.rpc(
                'complete_ticket_inactivity_charge_payment',
                {
                    p_charge_id: inactivityChargeId,
                    p_mp_payment_id: mpPaymentId,
                    p_mp_fee_amount: mpFeeAmount ?? 0,
                    p_net_received_amount: netAmountAfterMp ?? null,
                },
            );
            if (completeErr) {
                console.error('[MP Webhook] complete_ticket_inactivity_charge_payment:', completeErr);
                return new Response(JSON.stringify({ error: completeErr.message }), {
                    status: 500,
                    headers: corsHeaders,
                });
            }
        }

        return new Response(JSON.stringify({ received: true, type: 'ticket_inactivity_charge' }), {
            status: 200,
            headers: corsHeaders,
        });
    }

    const CONSUMPTION_LICENSE_CHARGE_PREFIX = 'consumption_license_charge:';
    if (externalReference.startsWith(CONSUMPTION_LICENSE_CHARGE_PREFIX)) {
        const licenseChargeId = externalReference.slice(CONSUMPTION_LICENSE_CHARGE_PREFIX.length);
        console.log(`[MP Webhook] Consumption license charge payment: ${licenseChargeId}, status=${paymentStatus}`);

        if (paymentStatus === 'approved' || paymentStatus === 'authorized') {
            const { error: completeErr } = await supabaseService.rpc(
                'complete_consumption_license_charge_payment',
                {
                    p_charge_id: licenseChargeId,
                    p_mp_payment_id: mpPaymentId,
                    p_mp_fee_amount: mpFeeAmount ?? 0,
                    p_net_received_amount: netAmountAfterMp ?? null,
                },
            );
            if (completeErr) {
                console.error('[MP Webhook] complete_consumption_license_charge_payment:', completeErr);
                return new Response(JSON.stringify({ error: completeErr.message }), {
                    status: 500,
                    headers: corsHeaders,
                });
            }
        }

        return new Response(JSON.stringify({ received: true, type: 'consumption_license_charge' }), {
            status: 200,
            headers: corsHeaders,
        });
    }

    const transactionId = externalReference;
    console.log(`[MP Webhook] Looking for receivable with transaction ID: ${transactionId}`);
    console.log(`[MP Webhook] Payment ID (resourceId): ${resourceId}`);

    if (!isInternalJob) {
      const { data: recvMeta } = await supabaseService
        .from('receivables')
        .select('event_id')
        .eq('id', transactionId)
        .maybeSingle();

      let shouldAsync = (Deno.env.get('MP_WEBHOOK_ASYNC') ?? '').trim() === 'true';

      if (recvMeta?.event_id) {
        const { data: evMeta } = await supabaseService
          .from('events')
          .select('checkout_async_webhook, inventory_mode')
          .eq('id', recvMeta.event_id)
          .maybeSingle();

        shouldAsync = shouldAsync
          || evMeta?.checkout_async_webhook === true
          || evMeta?.inventory_mode === 'counter';
      }

      if (shouldAsync) {
        const { data: enqueueResult, error: enqueueError } = await supabaseService.rpc(
          'enqueue_payment_webhook_job',
          {
            p_mp_payment_id: mpPaymentId ?? String(resourceId),
            p_external_reference: transactionId,
            p_event_id: recvMeta?.event_id ?? null,
            p_payment_status: paymentStatus ?? null,
            p_payload: mpPaymentData,
          },
        );

        if (enqueueError) {
          console.error('[MP Webhook] enqueue_payment_webhook_job:', enqueueError);
          return new Response(JSON.stringify({ error: enqueueError.message }), {
            status: 500,
            headers: corsHeaders,
          });
        }

        const payload = enqueueResult as { already_completed?: boolean; job_id?: string };
        if (payload?.already_completed) {
          return new Response(JSON.stringify({ message: 'Job already completed.' }), {
            status: 200,
            headers: corsHeaders,
          });
        }

        await logCheckoutOps({
          eventId: recvMeta?.event_id,
          correlationId: transactionId,
          operation: 'webhook_enqueued',
          details: { job_id: payload?.job_id ?? null, mp_payment_id: mpPaymentId },
        });

        const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
        const workerToken = (Deno.env.get('WEBHOOK_WORKER_TOKEN') ?? 'internal').trim();
        const triggerWorker = fetch(`${supabaseUrl}/functions/v1/process-payment-webhook-jobs`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`,
            'Content-Type': 'application/json',
            'X-Webhook-Worker-Token': workerToken,
          },
          body: JSON.stringify({ limit: 5 }),
        });

        // @ts-ignore Supabase Edge runtime
        if (typeof EdgeRuntime !== 'undefined' && typeof EdgeRuntime.waitUntil === 'function') {
          // @ts-ignore
          EdgeRuntime.waitUntil(triggerWorker);
        } else {
          triggerWorker.catch((err) => console.error('[MP Webhook] worker trigger failed:', err));
        }

        return new Response(JSON.stringify({
          queued: true,
          job_id: payload?.job_id ?? null,
        }), { status: 200, headers: corsHeaders });
      }
    }

    // 5. Buscar a transação na tabela 'receivables' usando o transactionId (external_reference)
    // Primeiro, tentar encontrar com status 'pending'
    let { data: receivable, error: fetchReceivableError } = await supabaseService
        .from('receivables')
        .select('id, client_user_id, wristband_analytics_ids, counter_reservation_items, manager_user_id, event_id, total_value, status, payment_gateway_id')
        .eq('id', transactionId)
        .eq('status', 'pending')
        .maybeSingle();

    // Se não encontrou com status 'pending', buscar sem filtro de status
    if (!receivable) {
        console.log(`[MP Webhook] Receivable not found with status 'pending', searching without status filter...`);
        const { data: receivableAnyStatus, error: fetchAnyStatusError } = await supabaseService
            .from('receivables')
            .select('id, client_user_id, wristband_analytics_ids, counter_reservation_items, manager_user_id, event_id, total_value, status, payment_gateway_id')
            .eq('id', transactionId)
            .maybeSingle();
        
        if (receivableAnyStatus) {
            console.log(`[MP Webhook] Found receivable with status: ${receivableAnyStatus.status}, payment_gateway_id: ${receivableAnyStatus.payment_gateway_id}`);
            if (receivableAnyStatus.status === 'paid') {
                // Idempotência robusta: só ignorar se split financeiro e vínculo dos ingressos
                // já estiverem concluídos. Caso contrário, reprocessar para recuperar consistência.
                const analyticsIds: string[] = Array.isArray(receivableAnyStatus.wristband_analytics_ids)
                  ? receivableAnyStatus.wristband_analytics_ids
                  : [];

                const [{ count: assignedCount, error: assignedError }, { count: splitCount, error: splitError }] = await Promise.all([
                  supabaseService
                    .from('wristband_analytics')
                    .select('id', { count: 'exact', head: true })
                    .in('id', analyticsIds)
                    .eq('client_user_id', receivableAnyStatus.client_user_id),
                  supabaseService
                    .from('financial_splits')
                    .select('id', { count: 'exact', head: true })
                    .eq('transaction_id', receivableAnyStatus.id),
                ]);

                if (assignedError || splitError) {
                    console.error('[MP Webhook] Error checking idempotency state:', { assignedError, splitError });
                }

                const expectedAssignments = analyticsIds.length;
                const isAssignmentsComplete = expectedAssignments > 0 && (assignedCount ?? 0) >= expectedAssignments;
                const isFinancialSplitComplete = (splitCount ?? 0) >= 1;

                if (isAssignmentsComplete && isFinancialSplitComplete) {
                    console.log(`[MP Webhook] Receivable already fully processed. Ignoring notification.`);
                    return new Response(JSON.stringify({ message: 'Receivable already processed.' }), { status: 200, headers: corsHeaders });
                }

                console.warn(
                  `[MP Webhook] Receivable marked as paid but incomplete. Reprocessing... assignments=${assignedCount ?? 0}/${expectedAssignments}, splits=${splitCount ?? 0}`,
                );
            }
            // Se está em outro status (ex: 'failed') ou paid incompleto, processar normalmente
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
                    .select('id, client_user_id, wristband_analytics_ids, counter_reservation_items, manager_user_id, event_id, total_value, status, payment_gateway_id')
                    .eq('payment_gateway_id', preferenceId)
                    .maybeSingle();
                
                if (receivableByGatewayId) {
                    console.log(`[MP Webhook] Found receivable by preference ID (payment_gateway_id): ${receivableByGatewayId.id}, status: ${receivableByGatewayId.status}`);
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
    await logPaymentEvent({
      transactionId: finalTransactionId,
      source: 'webhook',
      paymentStatus,
      receivableStatus: receivable.status,
      paymentStatusDetail,
      mpPaymentId,
      mpPreferenceId,
      payload: {
        notification_type: finalNotificationType,
        notification_type_raw: rawNotificationType,
        resource_id: resourceId,
      },
    });

    const clientUserId = receivable.client_user_id;
    let analyticsIds = receivable.wristband_analytics_ids as string[] | null;
    const counterReservationItems = receivable.counter_reservation_items;
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
            .update({
                status: 'paid',
                payment_status: paymentStatus || 'approved',
                mp_status_detail: paymentStatusDetail,
                mp_payment_id: mpPaymentId,
                mp_preference_id: mpPreferenceId,
                gross_amount: grossAmount,
                mp_fee_amount: mpFeeAmount,
                platform_fee_amount: platformFeeAmount,
                net_amount_after_mp: netAmountAfterMp,
                paid_at: new Date().toISOString(),
            })
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

        if (
          (!analyticsIds || analyticsIds.length === 0) &&
          counterReservationItems &&
          Array.isArray(counterReservationItems) &&
          counterReservationItems.length > 0
        ) {
          console.log(`[MP Webhook] Materializing counter inventory tickets for ${finalTransactionId}...`);
          const { data: materializeResult, error: materializeError } = await supabaseService.rpc(
            'materialize_counter_checkout_tickets',
            {
              p_transaction_id: finalTransactionId,
              p_client_user_id: clientUserId,
            },
          );
          if (materializeError) {
            console.error('[MP Webhook] CRITICAL: counter materialization failed:', materializeError);
            throw new Error(`Failed to materialize counter tickets: ${materializeError.message}`);
          }
          const matPayload = materializeResult as { analytics_ids?: string[] } | null;
          if (matPayload?.analytics_ids && Array.isArray(matPayload.analytics_ids)) {
            analyticsIds = matPayload.analytics_ids as string[];
          } else {
            const { data: refreshedReceivable } = await supabaseService
              .from('receivables')
              .select('wristband_analytics_ids')
              .eq('id', finalTransactionId)
              .maybeSingle();
            analyticsIds = (refreshedReceivable?.wristband_analytics_ids as string[] | null) ?? analyticsIds;
          }
          console.log(`[MP Webhook] Counter materialization complete. analytics count=${analyticsIds?.length ?? 0}`);
        }

        await logPaymentEvent({
          transactionId: finalTransactionId,
          source: 'webhook',
          paymentStatus,
          receivableStatus: 'paid',
          paymentStatusDetail,
          mpPaymentId,
          mpPreferenceId,
          payload: {
            stage: 'receivable_paid',
            gross_amount: grossAmount,
            mp_fee_amount: mpFeeAmount,
            platform_fee_amount: platformFeeAmount,
            net_amount_after_mp: netAmountAfterMp,
          },
        });

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

        const appliedPercentage = Number(eventData.applied_percentage ?? 0);
        const companyId = eventData.company_id;
        
        // Validação do percentual de comissão
        if (!Number.isFinite(appliedPercentage) || appliedPercentage < 0 || appliedPercentage > 100) {
            console.error(`[MP Webhook] Critical Error: Invalid applied_percentage (${appliedPercentage}) for event ${eventId}.`);
            throw new Error(`Invalid commission percentage for event ${eventId}.`);
        }

        // 6. Split alinhado ao extrato MP: gestor = net_received; plataforma = marketplace_fee
        const split = resolveSplitAmounts({
          grossFallback: Number(totalValue),
          appliedPercentage,
          financials: mpFinancials,
        });
        const grossSaleAmount = split.grossSaleAmount;
        const feeAmount = split.mpFeeAmount;
        const platformAmount = split.platformAmount;
        const managerAmount = split.managerAmount;

        console.log(`[MP Webhook] Financial Calculation for transaction ${finalTransactionId}:`);
        console.log(`  - Gross Sale Amount: R$ ${grossSaleAmount.toFixed(2)}`);
        console.log(`  - Mercado Pago Fee: R$ ${feeAmount.toFixed(2)}`);
        console.log(`  - Collector net (gestor extrato): R$ ${(split.collectorNetAmount ?? managerAmount).toFixed(2)}`);
        console.log(`  - Applied Percentage (evento): ${appliedPercentage}%`);
        console.log(`  - Platform Commission (extrato MP): R$ ${platformAmount.toFixed(2)}`);
        console.log(`  - Manager amount (financial_splits): R$ ${managerAmount.toFixed(2)}`);
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
                total_amount: grossSaleAmount,
                applied_percentage: appliedPercentage,
            },
            // Registro 2: Comissão da plataforma (sistema)
            {
                transaction_id: finalTransactionId,
                event_id: eventId,
                manager_user_id: managerUserId,
                platform_amount: platformAmount, // Valor > 0 identifica que este é a comissão do sistema
                manager_amount: 0, // Zero identifica que este é a comissão
                total_amount: grossSaleAmount,
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
        }

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
                gross_sale_amount: grossSaleAmount,
                mercadopago_fee_amount: feeAmount,
                net_after_mp_amount: netAfterMpAmount,
            };
            
            return {
                id: record.id,
                wristband_id: record.wristband_id, // Campo obrigatório
                code_wristbands: record.code_wristbands, // Campo obrigatório
                sequential_number: record.sequential_number, // Campo obrigatório (pode ser null, mas incluímos)
                client_user_id: clientUserId,
                status: 'active',
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
                    status: 'active',
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

        await logCheckoutOps({
          eventId: receivable.event_id,
          correlationId: finalTransactionId,
          operation: 'webhook_processed',
          details: {
            mp_payment_id: mpPaymentId,
            tickets_updated: updates.length,
          },
        });
        
        return new Response(JSON.stringify({ 
            message: 'Payment approved, financial split recorded, and tickets assigned.',
            transaction_id: finalTransactionId,
            status: 'paid'
        }), { status: 200, headers: corsHeaders });

    } else if (paymentStatus === 'rejected' || paymentStatus === 'cancelled') {
        console.log(`[MP Webhook] Payment ${paymentStatus}. Releasing reservation for ${finalTransactionId}...`);

        if (receivable.status === 'pending') {
            const { error: releaseError } = await supabaseService.rpc('release_ticket_checkout_reservation', {
                p_transaction_id: finalTransactionId,
                p_reason: paymentStatus,
            });

            if (releaseError) {
                console.error(`[MP Webhook] Failed to release checkout reservation for transaction ${finalTransactionId}:`, releaseError);
            } else {
                console.log(`[MP Webhook] Released checkout reservation for failed/cancelled transaction ${finalTransactionId}.`);
            }
        }

        console.log(`[MP Webhook] Updating receivable ${finalTransactionId} to 'failed'...`);
        const { error: updateReceivableError } = await supabaseService
            .from('receivables')
            .update({
                status: 'failed',
                payment_status: paymentStatus,
                mp_status_detail: paymentStatusDetail,
                mp_payment_id: mpPaymentId,
                mp_preference_id: mpPreferenceId,
                gross_amount: grossAmount,
                mp_fee_amount: mpFeeAmount,
                platform_fee_amount: platformFeeAmount,
                net_amount_after_mp: netAmountAfterMp,
            })
            .eq('id', finalTransactionId);

        if (updateReceivableError) {
            console.error(`[MP Webhook] CRITICAL: Failed to update receivable to 'failed':`, updateReceivableError);
            throw updateReceivableError;
        }

        console.log(`[MP Webhook] Receivable ${finalTransactionId} marked as 'failed'`);
        await logPaymentEvent({
          transactionId: finalTransactionId,
          source: 'webhook',
          paymentStatus,
          receivableStatus: 'failed',
          paymentStatusDetail,
          mpPaymentId,
          mpPreferenceId,
          payload: { stage: 'receivable_failed' },
        });
        // NOTA: Não precisamos reverter o status 'active' dos analytics, pois eles nunca foram alterados.
        
        return new Response(JSON.stringify({ message: `Payment ${paymentStatus}. Transaction marked as failed.` }), { status: 200, headers: corsHeaders });
    } else {
        // Status não tratado (pending, in_process sem date_approved, etc.)
        console.log(`[MP Webhook] Payment status '${paymentStatus}' not processed. Transaction ${finalTransactionId} remains in current status.`);
        console.log(`[MP Webhook] Payment will be processed when status changes to 'approved' or 'authorized'.`);
        await supabaseService
            .from('receivables')
            .update({
                payment_status: paymentStatus || 'pending',
                mp_status_detail: paymentStatusDetail,
                mp_payment_id: mpPaymentId,
                mp_preference_id: mpPreferenceId,
                gross_amount: grossAmount,
                mp_fee_amount: mpFeeAmount,
                platform_fee_amount: platformFeeAmount,
                net_amount_after_mp: netAmountAfterMp,
            })
            .eq('id', finalTransactionId);
        await logPaymentEvent({
          transactionId: finalTransactionId,
          source: 'webhook',
          paymentStatus,
          receivableStatus: receivable.status,
          paymentStatusDetail,
          mpPaymentId,
          mpPreferenceId,
          payload: { stage: 'status_pending_or_processing' },
        });
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
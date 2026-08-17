/**
 * Carga — compra de produto no app (intent + confirm)
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, AUTH_TOKEN ou AUTH_TOKENS (csv)
 *      ESTABLISHMENT_ID, PRODUCT_ID
 *      EVENT_ID (opcional), PRODUCT_QTY (default 1)
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import {
  getSupabaseUrl,
  getAnonKey,
  pickAuthToken,
  requireEnv,
  clientHeaders,
  stressOptions,
  safeJson,
} from './_shared.js';

const establishmentId = __ENV.ESTABLISHMENT_ID || '';
const productId = __ENV.PRODUCT_ID || '';
const eventId = (__ENV.EVENT_ID || '').trim();
const productQty = Number(__ENV.PRODUCT_QTY || '1');

export const options = stressOptions(5, '2m');

export function setup() {
  requireEnv([
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'AUTH_TOKEN',
    'ESTABLISHMENT_ID',
    'PRODUCT_ID',
  ]);
}

export default function () {
  const supabaseUrl = getSupabaseUrl();
  const anonKey = getAnonKey();
  const authToken = pickAuthToken(__VU, __ITER);
  const headers = clientHeaders(anonKey, authToken);

  const intentPayload = {
    establishmentId,
    items: [{ productId, quantity: productQty }],
  };
  if (eventId) intentPayload.eventId = eventId;

  const intentRes = http.post(
    `${supabaseUrl}/functions/v1/create-credit-consumption-intent`,
    JSON.stringify(intentPayload),
    {
      headers,
      tags: { name: 'consumption_create_intent' },
    },
  );

  const intentBody = safeJson(intentRes);
  const intentId = intentBody.intentId || intentBody.intent_id;
  const intentOk = intentRes.status === 200 && Boolean(intentId);

  check(intentRes, {
    'intent criado': () => intentOk || intentRes.status === 400 || intentRes.status === 402,
  });

  if (!intentOk) {
    if (__ITER === 0 && __VU === 1) {
      console.error('intent falhou:', intentRes.status, JSON.stringify(intentBody).slice(0, 400));
    }
    sleep(0.5);
    return;
  }

  const idempotencyKey = `k6-consume-${__VU}-${__ITER}-${randomString(8)}`;
  const confirmRes = http.post(
    `${supabaseUrl}/functions/v1/confirm-credit-consumption-intent`,
    JSON.stringify({
      intentId,
      biometricConfirmed: intentBody.biometricRequired === true || intentBody.biometric_required === true,
      idempotencyKey,
    }),
    {
      headers: {
        ...headers,
        'x-idempotency-key': idempotencyKey,
      },
      tags: { name: 'consumption_confirm_intent' },
    },
  );

  const confirmBody = safeJson(confirmRes);
  const confirmOk =
    confirmRes.status === 200 &&
    (confirmBody.ok === true || confirmBody.duplicate === true);

  check(confirmRes, {
    'confirm ok or saldo/estoque': () =>
      confirmOk || confirmRes.status === 400 || confirmRes.status === 402 || confirmRes.status === 409,
    'sem 5xx': (r) => r.status < 500,
  });

  sleep(Number(__ENV.SLEEP_SECONDS || '0.5'));
}

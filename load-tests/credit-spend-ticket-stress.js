/**
 * Carga — compra de ingresso com crédito EventFest
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, AUTH_TOKEN ou AUTH_TOKENS (csv)
 *      EVENT_ID, WRISTBAND_ID, UNIT_PRICE (default 10)
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

const eventId = __ENV.EVENT_ID || '';
const wristbandId = __ENV.WRISTBAND_ID || '';
const unitPrice = Number(__ENV.UNIT_PRICE || '10');

export const options = stressOptions(10, '2m');

export function setup() {
  requireEnv(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'AUTH_TOKEN', 'EVENT_ID', 'WRISTBAND_ID']);
}

export default function () {
  const supabaseUrl = getSupabaseUrl();
  const anonKey = getAnonKey();
  const authToken = pickAuthToken(__VU, __ITER);
  const idempotencyKey = `k6-credit-${__VU}-${__ITER}-${randomString(8)}`;

  const res = http.post(
    `${supabaseUrl}/functions/v1/credit-spend`,
    JSON.stringify({
      eventId,
      channel: 'web',
      idempotencyKey,
      purchaseItems: [
        {
          ticketTypeId: wristbandId,
          quantity: 1,
          price: unitPrice,
          name: 'Load test crédito',
        },
      ],
    }),
    {
      headers: {
        ...clientHeaders(anonKey, authToken),
        'x-idempotency-key': idempotencyKey,
      },
      tags: { name: 'credit_spend_ticket' },
    },
  );

  const body = safeJson(res);
  const accepted =
    (res.status === 200 && (body.ok === true || body.success === true)) ||
    body.duplicate === true;

  check(res, {
    'accepted or business error': (r) =>
      accepted || r.status === 400 || r.status === 409 || r.status === 402,
    'sem 5xx': (r) => r.status < 500,
  });

  sleep(Number(__ENV.SLEEP_SECONDS || '0.5'));
}

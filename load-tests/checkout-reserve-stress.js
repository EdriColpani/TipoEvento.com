import http from 'k6/http';
import { check, sleep } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const supabaseUrl = (__ENV.SUPABASE_URL || '').replace(/\/$/, '');
const anonKey = __ENV.SUPABASE_ANON_KEY || '';
const authToken = __ENV.AUTH_TOKEN || '';
const eventId = __ENV.EVENT_ID || '';
const wristbandId = __ENV.WRISTBAND_ID || '';
const unitPrice = Number(__ENV.UNIT_PRICE || '10');

const vus = Number(__ENV.STRESS_VUS || '30');
const duration = __ENV.STRESS_DURATION || '1m';

export const options = {
  scenarios: {
    concurrent_checkout: {
      executor: 'constant-vus',
      vus,
      duration,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.5'],
  },
};

export default function () {
  if (!supabaseUrl || !anonKey || !authToken || !eventId || !wristbandId) {
    throw new Error('Defina SUPABASE_URL, SUPABASE_ANON_KEY, AUTH_TOKEN, EVENT_ID, WRISTBAND_ID');
  }

  const idempotencyKey = `k6-${__VU}-${__ITER}-${randomString(8)}`;

  const res = http.post(
    `${supabaseUrl}/functions/v1/create-payment-preference`,
    JSON.stringify({
      eventId,
      clientOrigin: 'https://load-test.local',
      idempotencyKey,
      purchaseItems: [
        {
          ticketTypeId: wristbandId,
          quantity: 1,
          price: unitPrice,
          name: 'Load test',
        },
      ],
    }),
    {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
        'x-idempotency-key': idempotencyKey,
      },
      tags: { name: 'checkout_reserve' },
    },
  );

  check(res, {
    'accepted or conflict': (r) => r.status === 200 || r.status === 409 || r.status === 400,
  });

  sleep(0.5);
}

export function teardown() {
  if (!supabaseUrl || !anonKey || !authToken || !eventId) return;

  const res = http.post(
    `${supabaseUrl}/rest/v1/rpc/verify_event_inventory_integrity`,
    JSON.stringify({ p_event_id: eventId }),
    {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
    },
  );

  const body = JSON.parse(res.body || '{}');
  if (body.ok !== true) {
    console.error('TEARDOWN INTEGRITY FAIL — possível overselling:', JSON.stringify(body));
  } else {
    console.log('TEARDOWN INTEGRITY OK');
  }
}

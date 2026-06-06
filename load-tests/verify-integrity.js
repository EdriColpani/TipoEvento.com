import http from 'k6/http';
import { check } from 'k6';

const supabaseUrl = (__ENV.SUPABASE_URL || '').replace(/\/$/, '');
const anonKey = __ENV.SUPABASE_ANON_KEY || '';
const authToken = __ENV.AUTH_TOKEN || '';
const eventId = __ENV.EVENT_ID || '';

export const options = {
  vus: 1,
  iterations: 1,
};

export default function () {
  if (!supabaseUrl || !anonKey || !authToken || !eventId) {
    throw new Error('Defina SUPABASE_URL, SUPABASE_ANON_KEY, AUTH_TOKEN e EVENT_ID');
  }

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

  check(res, {
    'status 200': (r) => r.status === 200,
    'integrity ok': () => body.ok === true,
    'no violations': () => !body.violations || body.violations.length === 0,
  });

  if (body.ok !== true) {
    console.error('INTEGRITY FAIL:', JSON.stringify(body));
  }
}

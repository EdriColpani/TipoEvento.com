import http from 'k6/http';
import { check, sleep } from 'k6';

const supabaseUrl = (__ENV.SUPABASE_URL || '').replace(/\/$/, '');
const anonKey = __ENV.SUPABASE_ANON_KEY || '';
const eventId = __ENV.EVENT_ID || '';

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '1m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<800'],
    checks: ['rate>0.95'],
  },
};

export default function () {
  if (!supabaseUrl || !anonKey || !eventId) {
    throw new Error('Defina SUPABASE_URL, SUPABASE_ANON_KEY e EVENT_ID');
  }

  const res = http.post(
    `${supabaseUrl}/rest/v1/rpc/get_event_ticket_availability`,
    JSON.stringify({ p_event_id: eventId }),
    {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      tags: { name: 'availability' },
    },
  );

  check(res, {
    'status 200': (r) => r.status === 200,
    'payload ok': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body && (body.ok === true || body.ticket_types !== undefined);
      } catch {
        return false;
      }
    },
  });

  sleep(0.2);
}

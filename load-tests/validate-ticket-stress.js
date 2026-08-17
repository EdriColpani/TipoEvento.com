/**
 * Carga na portaria — edge validate-ticket
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, VALIDATION_API_KEY
 *      WRISTBAND_CODES (csv) ou WRISTBAND_CODE (único)
 *      VALIDATION_TYPE=entry|exit|auto (default entry)
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import {
  getSupabaseUrl,
  getAnonKey,
  parseCsvEnv,
  pickFromPool,
  requireEnv,
  validatorHeaders,
  stressOptions,
  safeJson,
} from './_shared.js';

const codes = new SharedArray('wristband_codes', () => {
  const list = parseCsvEnv('WRISTBAND_CODES');
  if (list.length) return list;
  const single = (__ENV.WRISTBAND_CODE || '').trim();
  return single ? [single] : [];
});

const validationType = (__ENV.VALIDATION_TYPE || 'entry').trim();

http.setResponseCallback(http.expectedStatuses(200, 400, 403, 404, 409));

export const options = stressOptions(10, '2m');

export function setup() {
  requireEnv(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'VALIDATION_API_KEY']);
  if (!codes.length) {
    throw new Error('Defina WRISTBAND_CODES (csv) ou WRISTBAND_CODE');
  }
  return { codeCount: codes.length };
}

export default function () {
  const supabaseUrl = getSupabaseUrl();
  const anonKey = getAnonKey();
  const apiKey = __ENV.VALIDATION_API_KEY || '';
  const code = pickFromPool(codes, __VU, __ITER);

  const res = http.post(
    `${supabaseUrl}/functions/v1/validate-ticket`,
    JSON.stringify({
      wristband_code: code,
      validation_type: validationType,
    }),
    {
      headers: validatorHeaders(anonKey, apiKey),
      tags: { name: 'validate_ticket' },
    },
  );

  const body = safeJson(res);
  const ok =
    res.status === 200 && body.success === true;
  const expectedFailure =
    res.status >= 400 &&
    res.status < 500 &&
    (body.error_code === 'already_used' ||
      body.validation_status === 'invalid' ||
      body.success === false);

  check(res, {
    '2xx success or expected 4xx': () => ok || expectedFailure || res.status === 200,
    'latência < 3s': (r) => r.timings.duration < 3000,
  });

  sleep(Number(__ENV.SLEEP_SECONDS || '0.2'));
}

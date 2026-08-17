/**
 * Carga na entrega de consumo — edge validate-consumption-delivery
 *
 * Cada token EFDEL só pode ser completado uma vez. Use pool >= VUs × iterações.
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, CONSUMPTION_API_KEY
 *      DELIVERY_TOKENS (csv de EFDEL....)
 *      DELIVERY_ACTION=preview|complete|both (default both)
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

const tokens = new SharedArray('delivery_tokens', () => parseCsvEnv('DELIVERY_TOKENS'));
const actionMode = (__ENV.DELIVERY_ACTION || 'both').trim().toLowerCase();

http.setResponseCallback(http.expectedStatuses(200, 400, 403, 404, 409));

export const options = stressOptions(5, '2m');

export function setup() {
  requireEnv(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'CONSUMPTION_API_KEY']);
  if (!tokens.length) {
    throw new Error('Defina DELIVERY_TOKENS com códigos EFDEL (csv)');
  }
  return { tokenCount: tokens.length };
}

function postDelivery(supabaseUrl, headers, action, token) {
  return http.post(
    `${supabaseUrl}/functions/v1/validate-consumption-delivery`,
    JSON.stringify({
      action,
      delivery_token: token,
    }),
    {
      headers,
      tags: { name: `consumption_delivery_${action}` },
    },
  );
}

export default function () {
  const supabaseUrl = getSupabaseUrl();
  const anonKey = getAnonKey();
  const apiKey = __ENV.CONSUMPTION_API_KEY || '';
  const headers = validatorHeaders(anonKey, apiKey);
  const token = pickFromPool(tokens, __VU, __ITER);

  if (actionMode === 'preview' || actionMode === 'both') {
    const preview = postDelivery(supabaseUrl, headers, 'preview', token);
    const previewBody = safeJson(preview);
    check(preview, {
      'preview 2xx': (r) => r.status === 200,
      'preview success': () => previewBody.success === true,
    });
  }

  if (actionMode === 'complete' || actionMode === 'both') {
    const complete = postDelivery(supabaseUrl, headers, 'complete', token);
    const completeBody = safeJson(complete);
    const ok = complete.status === 200 && completeBody.success === true;
    const alreadyDone =
      complete.status >= 400 &&
      (completeBody.error_code === 'already_completed' ||
        completeBody.error_code === 'intent_not_ready' ||
        completeBody.success === false);

    check(complete, {
      'complete ok or already used': () => ok || alreadyDone,
    });
  }

  sleep(Number(__ENV.SLEEP_SECONDS || '0.3'));
}

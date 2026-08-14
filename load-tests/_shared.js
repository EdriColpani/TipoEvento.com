/** Helpers compartilhados entre scripts k6 EventFest */

export function getSupabaseUrl() {
  return (__ENV.SUPABASE_URL || '').replace(/\/$/, '');
}

export function getAnonKey() {
  return __ENV.SUPABASE_ANON_KEY || '';
}

export function parseCsvEnv(name) {
  const raw = __ENV[name] || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export function pickFromPool(pool, vu, iter) {
  if (!pool.length) return null;
  return pool[(vu + iter) % pool.length];
}

export function pickAuthToken(vu, iter) {
  const pool = parseCsvEnv('AUTH_TOKENS');
  if (pool.length) return pickFromPool(pool, vu, iter);
  return __ENV.AUTH_TOKEN || '';
}

export function requireEnv(names) {
  const missing = names.filter((name) => {
    if (name === 'AUTH_TOKEN') {
      return !__ENV.AUTH_TOKEN && !__ENV.AUTH_TOKENS;
    }
    return !__ENV[name];
  });
  if (missing.length) {
    throw new Error(`Defina: ${missing.join(', ')}`);
  }
}

export function clientHeaders(anonKey, authToken) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${authToken}`,
    'Content-Type': 'application/json',
  };
}

export function validatorHeaders(anonKey, apiKey) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    'x-api-key': apiKey,
    'Content-Type': 'application/json',
  };
}

export function stressOptions(defaultVus = 10, defaultDuration = '2m') {
  const vus = Number(__ENV.STRESS_VUS || String(defaultVus));
  const duration = __ENV.STRESS_DURATION || defaultDuration;
  return {
    scenarios: {
      stress: {
        executor: 'constant-vus',
        vus,
        duration,
      },
    },
    thresholds: {
      http_req_failed: ['rate<0.5'],
      http_req_duration: ['p(95)<3000'],
    },
  };
}

export function safeJson(res) {
  try {
    return JSON.parse(res.body || '{}');
  } catch {
    return {};
  }
}

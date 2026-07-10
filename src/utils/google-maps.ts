export const GOOGLE_MAPS_API_KEY =
  (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() || undefined;

/** Instruções exibidas quando a chave existe mas o Google bloqueia (ApiTargetBlockedMapError). */
export const GOOGLE_MAPS_SETUP_HINT =
  'No Google Cloud: habilite Maps JavaScript API, Places API, Geocoding API e Maps Embed API; ' +
  'na chave, use restrição por referenciador HTTP com https://eventfest.com.br/* e billing ativo.';

let mapsAuthFailed = false;
const authFailureListeners = new Set<(failed: boolean) => void>();

function notifyAuthFailureListeners() {
  authFailureListeners.forEach((cb) => cb(mapsAuthFailed));
}

/** Registra callback do Google quando a chave/domínio é rejeitado (gm_authFailure). */
export function installGoogleMapsAuthFailureHandler(): void {
  if (typeof window === 'undefined') return;
  const w = window as Window & { gm_authFailure?: () => void };
  if (w.__gmAuthFailureInstalled) return;
  w.__gmAuthFailureInstalled = true;
  w.gm_authFailure = () => {
    mapsAuthFailed = true;
    notifyAuthFailureListeners();
  };
}

export function subscribeGoogleMapsAuthFailure(listener: (failed: boolean) => void): () => void {
  installGoogleMapsAuthFailureHandler();
  authFailureListeners.add(listener);
  listener(mapsAuthFailed);
  return () => authFailureListeners.delete(listener);
}

export function isGoogleMapsAuthFailed(): boolean {
  return mapsAuthFailed;
}

export function isGoogleMapsConfigured(): boolean {
  return Boolean(GOOGLE_MAPS_API_KEY);
}

if (typeof window !== 'undefined') {
  installGoogleMapsAuthFailureHandler();
}

export interface EventMapQuery {
  location?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export function buildMapSearchQuery(params: EventMapQuery): string {
  if (params.lat != null && params.lng != null && Number.isFinite(params.lat) && Number.isFinite(params.lng)) {
    return `${params.lat},${params.lng}`;
  }
  // Endereço cadastrado tem prioridade; não misturar com nome fantasia.
  const address = (params.address ?? '').trim();
  if (address) return address;
  return (params.location ?? '').trim();
}

export function buildGoogleMapsEmbedUrl(params: EventMapQuery): string | null {
  const key = GOOGLE_MAPS_API_KEY;
  if (!key) return null;

  if (params.lat != null && params.lng != null && Number.isFinite(params.lat) && Number.isFinite(params.lng)) {
    return `https://www.google.com/maps/embed/v1/view?key=${encodeURIComponent(key)}&center=${params.lat},${params.lng}&zoom=16`;
  }

  const q = buildMapSearchQuery(params);
  if (!q) return null;
  return `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}`;
}

export function buildGoogleMapsOpenUrl(params: EventMapQuery): string | null {
  const q = buildMapSearchQuery(params);
  if (!q) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export function buildGoogleMapsDirectionsUrl(
  params: EventMapQuery & { originLat?: number | null; originLng?: number | null },
): string | null {
  const destination = buildMapSearchQuery(params);
  if (!destination) return null;

  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('destination', destination);
  url.searchParams.set('travelmode', 'driving');

  if (
    params.originLat != null &&
    params.originLng != null &&
    Number.isFinite(params.originLat) &&
    Number.isFinite(params.originLng)
  ) {
    url.searchParams.set('origin', `${params.originLat},${params.originLng}`);
  }

  return url.toString();
}

/** Obtém a posição atual do cliente (com timeout) ou null se negar/falhar. */
export function getCurrentPositionCoords(timeoutMs = 8_000): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        window.clearTimeout(timer);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        window.clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

/** Abre Google Maps com rota da localização do cliente até o destino. */
export async function openGoogleMapsRouteFromUser(params: EventMapQuery): Promise<boolean> {
  const destination = buildMapSearchQuery(params);
  if (!destination) return false;

  const origin = await getCurrentPositionCoords();
  const url = buildGoogleMapsDirectionsUrl({
    ...params,
    originLat: origin?.lat,
    originLng: origin?.lng,
  });
  if (!url) return false;

  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}

let loadPromise: Promise<void> | null = null;
let loadCorePromise: Promise<void> | null = null;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      window.setTimeout(() => resolve(fallback), timeoutMs);
    }),
  ]);
}

function mapsCoreAvailable(): boolean {
  return Boolean(window.google?.maps);
}

function placesAutocompleteAvailable(): boolean {
  return Boolean(window.google?.maps?.places?.Autocomplete);
}

function waitForPlacesAutocomplete(timeoutMs = 8000): Promise<void> {
  if (placesAutocompleteAvailable()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (placesAutocompleteAvailable()) {
        resolve();
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        reject(
          new Error(
            'Google Places indisponível. Verifique VITE_GOOGLE_MAPS_API_KEY, billing e referrers HTTP no Google Cloud.',
          ),
        );
        return;
      }
      window.setTimeout(check, 100);
    };
    check();
  });
}

export function loadGoogleMapsPlaces(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Maps só está disponível no navegador.'));
  }
  if (!GOOGLE_MAPS_API_KEY) {
    return Promise.reject(new Error('VITE_GOOGLE_MAPS_API_KEY não configurada.'));
  }
  if (placesAutocompleteAvailable()) {
    return Promise.resolve();
  }
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const finishOk = () => {
      waitForPlacesAutocomplete()
        .then(resolve)
        .catch((err) => {
          loadPromise = null;
          reject(err);
        });
    };
    const finishErr = (message: string) => {
      loadPromise = null;
      reject(new Error(message));
    };

    const existing = document.querySelector<HTMLScriptElement>('script[data-google-maps-loader]');
    if (existing) {
      if (placesAutocompleteAvailable()) {
        resolve();
        return;
      }
      existing.addEventListener('load', finishOk, { once: true });
      existing.addEventListener('error', () => finishErr('Falha ao carregar Google Maps.'), { once: true });
      void waitForPlacesAutocomplete()
        .then(resolve)
        .catch((err) => {
          loadPromise = null;
          reject(err);
        });
      return;
    }

    const script = document.createElement('script');
    script.dataset.googleMapsLoader = 'true';
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&libraries=places&language=pt-BR&region=BR&loading=async`;
    script.onload = finishOk;
    script.onerror = () => finishErr('Falha ao carregar Google Maps.');
    document.head.appendChild(script);
  });

  return loadPromise;
}

/** Carrega Maps JS sem exigir Places (geocoding / embed). */
export function loadGoogleMapsCore(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Maps só está disponível no navegador.'));
  }
  if (!GOOGLE_MAPS_API_KEY) {
    return Promise.reject(new Error('VITE_GOOGLE_MAPS_API_KEY não configurada.'));
  }
  if (mapsCoreAvailable()) {
    return Promise.resolve();
  }
  if (loadCorePromise) return loadCorePromise;

  loadCorePromise = new Promise((resolve, reject) => {
    const finishOk = () => {
      const started = Date.now();
      const check = () => {
        if (mapsCoreAvailable()) {
          resolve();
          return;
        }
        if (Date.now() - started >= 6000) {
          loadCorePromise = null;
          reject(new Error('Google Maps indisponível (timeout).'));
          return;
        }
        window.setTimeout(check, 100);
      };
      check();
    };
    const finishErr = (message: string) => {
      loadCorePromise = null;
      reject(new Error(message));
    };

    const existing = document.querySelector<HTMLScriptElement>('script[data-google-maps-loader]');
    if (existing) {
      if (mapsCoreAvailable()) {
        resolve();
        return;
      }
      existing.addEventListener('load', finishOk, { once: true });
      existing.addEventListener('error', () => finishErr('Falha ao carregar Google Maps.'), { once: true });
      void finishOk();
      return;
    }

    const script = document.createElement('script');
    script.dataset.googleMapsLoader = 'true';
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&libraries=places&language=pt-BR&region=BR&loading=async`;
    script.onload = finishOk;
    script.onerror = () => finishErr('Falha ao carregar Google Maps.');
    document.head.appendChild(script);
  });

  return loadCorePromise;
}

export interface GeocodedAddress {
  address: string;
  lat: number;
  lng: number;
  placeId: string | null;
}

/** Geocodifica endereço digitado manualmente (Geocoding API via JS). */
export async function geocodeBrazilAddress(query: string): Promise<GeocodedAddress | null> {
  const trimmed = query.trim();
  if (!trimmed || !isGoogleMapsConfigured()) return null;

  try {
    await withTimeout(loadGoogleMapsCore(), 6000, undefined);
  } catch {
    return null;
  }

  if (!google.maps?.Geocoder) return null;

  const geocoder = new google.maps.Geocoder();

  const geocodePromise = new Promise<GeocodedAddress | null>((resolve) => {
    geocoder.geocode({ address: trimmed, componentRestrictions: { country: 'BR' } }, (results, status) => {
      if (status !== 'OK' || !results?.[0]?.geometry?.location) {
        resolve(null);
        return;
      }
      const best = results[0];
      resolve({
        address: best.formatted_address?.trim() || trimmed,
        lat: best.geometry!.location!.lat(),
        lng: best.geometry!.location!.lng(),
        placeId: best.place_id ?? null,
      });
    });
  });

  return withTimeout(geocodePromise, 6000, null);
}

export interface EventGeoValues {
  address: string;
  location?: string | null;
  address_lat?: number | null;
  address_lng?: number | null;
  address_place_id?: string | null;
}

/** Preenche lat/lng ao salvar se o gestor digitou endereço sem escolher sugestão do Places. */
export async function resolveEventGeoOnSave(values: EventGeoValues): Promise<EventGeoValues> {
  if (!isGoogleMapsConfigured()) return values;
  if (!values.address?.trim()) return values;
  if (values.address_lat != null && values.address_lng != null) return values;

  try {
    const geocoded = await withTimeout(
      geocodeBrazilAddress(buildMapSearchQuery({ address: values.address, location: values.location })),
      7000,
      null,
    );
    if (!geocoded) return values;

    return {
      ...values,
      address: geocoded.address,
      address_lat: geocoded.lat,
      address_lng: geocoded.lng,
      address_place_id: geocoded.placeId ?? values.address_place_id ?? null,
    };
  } catch {
    return values;
  }
}

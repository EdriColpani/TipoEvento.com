export const GOOGLE_MAPS_API_KEY =
  (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() || undefined;

export function isGoogleMapsConfigured(): boolean {
  return Boolean(GOOGLE_MAPS_API_KEY);
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
  const parts = [params.address, params.location].map((s) => (s ?? '').trim()).filter(Boolean);
  return parts.join(', ');
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

export function buildGoogleMapsDirectionsUrl(params: EventMapQuery): string | null {
  const destination = buildMapSearchQuery(params);
  if (!destination) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

let loadPromise: Promise<void> | null = null;

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
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&libraries=places&language=pt-BR&region=BR`;
    script.onload = finishOk;
    script.onerror = () => finishErr('Falha ao carregar Google Maps.');
    document.head.appendChild(script);
  });

  return loadPromise;
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

  await loadGoogleMapsPlaces();
  if (!google.maps?.Geocoder) return null;

  const geocoder = new google.maps.Geocoder();

  return new Promise((resolve) => {
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

  const geocoded = await geocodeBrazilAddress(
    buildMapSearchQuery({ address: values.address, location: values.location }),
  );
  if (!geocoded) return values;

  return {
    ...values,
    address: geocoded.address,
    address_lat: geocoded.lat,
    address_lng: geocoded.lng,
    address_place_id: geocoded.placeId ?? values.address_place_id ?? null,
  };
}

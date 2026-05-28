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

export function loadGoogleMapsPlaces(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Maps só está disponível no navegador.'));
  }
  if (!GOOGLE_MAPS_API_KEY) {
    return Promise.reject(new Error('VITE_GOOGLE_MAPS_API_KEY não configurada.'));
  }
  if (window.google?.maps?.places) {
    return Promise.resolve();
  }
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-maps-loader]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Falha ao carregar Google Maps.')));
      return;
    }

    const script = document.createElement('script');
    script.dataset.googleMapsLoader = 'true';
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&libraries=places&language=pt-BR&region=BR`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Falha ao carregar Google Maps.'));
    document.head.appendChild(script);
  });

  return loadPromise;
}

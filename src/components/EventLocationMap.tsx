import React, { useMemo } from 'react';
import { ExternalLink, MapPin, Navigation } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  buildGoogleMapsDirectionsUrl,
  buildGoogleMapsEmbedUrl,
  buildGoogleMapsOpenUrl,
  isGoogleMapsConfigured,
  type EventMapQuery,
} from '@/utils/google-maps';

export interface EventLocationMapProps {
  location: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** Altura do iframe (ex.: preview no formulário) */
  mapHeightClass?: string;
  showAddressHeader?: boolean;
  compact?: boolean;
}

const EventLocationMap: React.FC<EventLocationMapProps> = ({
  location,
  address,
  lat,
  lng,
  mapHeightClass = 'h-48 sm:h-64',
  showAddressHeader = true,
  compact = false,
}) => {
  const query: EventMapQuery = useMemo(
    () => ({ location, address, lat, lng }),
    [location, address, lat, lng],
  );

  const embedUrl = buildGoogleMapsEmbedUrl(query);
  const openUrl = buildGoogleMapsOpenUrl(query);
  const directionsUrl = buildGoogleMapsDirectionsUrl(query);
  const hasLocationText = Boolean((location ?? '').trim() || (address ?? '').trim());
  const mapsConfigured = isGoogleMapsConfigured();

  if (!hasLocationText) {
    return (
      <p className="text-gray-400 text-sm">Endereço do evento não informado.</p>
    );
  }

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      {showAddressHeader && (
        <div className="flex items-start space-x-3">
          <MapPin className="text-yellow-500 h-5 w-5 mt-0.5 flex-shrink-0" />
          <div>
            {location?.trim() ? (
              <h4 className="text-white font-semibold text-base sm:text-lg mb-1">{location}</h4>
            ) : null}
            {address?.trim() ? (
              <p className="text-gray-300 text-sm sm:text-base">{address}</p>
            ) : null}
          </div>
        </div>
      )}

      {embedUrl ? (
        <div className={`w-full overflow-hidden rounded-xl border border-yellow-500/20 bg-black/40 ${mapHeightClass}`}>
          <iframe
            title="Mapa do local do evento"
            src={embedUrl}
            className="h-full w-full border-0"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
          />
        </div>
      ) : (
        <div
          className={`bg-black/40 rounded-xl border border-yellow-500/20 flex items-center justify-center ${mapHeightClass}`}
        >
          <div className="text-center px-4">
            <MapPin className="text-yellow-500 h-8 w-8 mx-auto mb-2" />
            <p className="text-gray-400 text-sm">
              {mapsConfigured
                ? 'Não foi possível exibir o mapa. Use o botão abaixo para abrir no Google Maps.'
                : 'Configure VITE_GOOGLE_MAPS_API_KEY para exibir o mapa embutido.'}
            </p>
          </div>
        </div>
      )}

      {(openUrl || directionsUrl) && (
        <div className="flex flex-col sm:flex-row gap-2">
          {openUrl && (
            <Button
              type="button"
              variant="outline"
              className="border-yellow-500/40 text-yellow-500 hover:bg-yellow-500/10"
              asChild
            >
              <a href={openUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" />
                Abrir no Google Maps
              </a>
            </Button>
          )}
          {directionsUrl && (
            <Button
              type="button"
              variant="outline"
              className="border-yellow-500/30 text-gray-200 hover:bg-white/5"
              asChild
            >
              <a href={directionsUrl} target="_blank" rel="noopener noreferrer">
                <Navigation className="h-4 w-4 mr-2" />
                Como chegar
              </a>
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

export default EventLocationMap;

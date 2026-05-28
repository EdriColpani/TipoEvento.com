import React, { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { isGoogleMapsConfigured, loadGoogleMapsPlaces } from '@/utils/google-maps';

export interface EventGeoSelection {
  address: string;
  lat: number;
  lng: number;
  placeId: string | null;
  venueName: string | null;
}

interface EventAddressAutocompleteProps {
  value: string;
  onChange: (address: string) => void;
  onPlaceSelect: (place: EventGeoSelection) => void;
  onGeoClear?: () => void;
  disabled?: boolean;
  placeholder?: string;
  inputClassName?: string;
}

const EventAddressAutocomplete: React.FC<EventAddressAutocompleteProps> = ({
  value,
  onChange,
  onPlaceSelect,
  onGeoClear,
  disabled,
  placeholder = 'Digite e selecione o endereço no Google',
  inputClassName,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const lastSelectedAddressRef = useRef<string | null>(null);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState<string | null>(null);
  const mapsConfigured = isGoogleMapsConfigured();

  useEffect(() => {
    if (!mapsConfigured || disabled) return;

    let cancelled = false;

    loadGoogleMapsPlaces()
      .then(() => {
        if (!cancelled) setMapsReady(true);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setMapsError(err instanceof Error ? err.message : 'Não foi possível carregar o Google Maps.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mapsConfigured, disabled]);

  useEffect(() => {
    if (!mapsReady || !inputRef.current || disabled || !mapsConfigured) return;

    const autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
      componentRestrictions: { country: 'br' },
      fields: ['formatted_address', 'geometry', 'place_id', 'name', 'address_components'],
    });

    const listener: google.maps.MapsEventListener = autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      const lat = place.geometry?.location?.lat();
      const lng = place.geometry?.location?.lng();
      const formatted = place.formatted_address?.trim();
      if (lat == null || lng == null || !formatted) return;

      const venueName = inferVenueName(place);
      lastSelectedAddressRef.current = formatted;
      onChange(formatted);
      onPlaceSelect({
        address: formatted,
        lat,
        lng,
        placeId: place.place_id ?? null,
        venueName,
      });
    });

    autocompleteRef.current = autocomplete;

    return () => {
      listener.remove();
      autocompleteRef.current = null;
    };
  }, [mapsReady, disabled, mapsConfigured, onChange, onPlaceSelect]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    onChange(next);
    if (lastSelectedAddressRef.current && next.trim() !== lastSelectedAddressRef.current) {
      lastSelectedAddressRef.current = null;
      onGeoClear?.();
    }
  };

  return (
    <div className="space-y-1">
      <Input
        ref={inputRef}
        value={value}
        onChange={handleInputChange}
        disabled={disabled}
        placeholder={
          mapsConfigured
            ? placeholder
            : 'Ex: Rua Principal, 123 - Centro, Cidade - UF'
        }
        autoComplete="off"
        className={
          inputClassName ??
          'bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500'
        }
      />
      {mapsConfigured && !mapsReady && !mapsError && (
        <p className="text-xs text-gray-500 flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Carregando busca de endereço…
        </p>
      )}
      {mapsError && <p className="text-xs text-amber-500/90">{mapsError}</p>}
      {mapsConfigured && mapsReady && (
        <p className="text-xs text-gray-500">
          Selecione uma sugestão do Google para fixar o ponto no mapa.
        </p>
      )}
      {!mapsConfigured && (
        <p className="text-xs text-gray-500">
          Sem chave do Google Maps: digite o endereço completo manualmente.
        </p>
      )}
    </div>
  );
};

function inferVenueName(place: google.maps.places.PlaceResult): string | null {
  const name = place.name?.trim();
  if (!name) return null;
  const formatted = place.formatted_address?.trim() ?? '';
  if (formatted && name === formatted) return null;
  return name;
}

export default EventAddressAutocomplete;

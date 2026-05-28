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

function detachAutocompleteListener(listener: google.maps.MapsEventListener | null | undefined): void {
  if (!listener) return;
  if (typeof listener.remove === 'function') {
    listener.remove();
    return;
  }
  if (typeof google.maps?.event?.removeListener === 'function') {
    google.maps.event.removeListener(listener);
  }
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
  const lastSelectedAddressRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  const onPlaceSelectRef = useRef(onPlaceSelect);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState<string | null>(null);
  const mapsConfigured = isGoogleMapsConfigured();

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onPlaceSelectRef.current = onPlaceSelect;
  }, [onPlaceSelect]);

  useEffect(() => {
    if (!mapsConfigured || disabled) return;

    let cancelled = false;

    loadGoogleMapsPlaces()
      .then(() => {
        if (!cancelled) {
          setMapsReady(true);
          setMapsError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setMapsReady(false);
          setMapsError(err instanceof Error ? err.message : 'Não foi possível carregar o Google Maps.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mapsConfigured, disabled]);

  useEffect(() => {
    if (!mapsReady || !inputRef.current || disabled || !mapsConfigured) return;

    let listener: google.maps.MapsEventListener | null = null;
    let autocomplete: google.maps.places.Autocomplete | null = null;

    try {
      if (!google.maps?.places?.Autocomplete) {
        setMapsError(
          'Google Places indisponível. Verifique a chave da API e os referrers autorizados no Google Cloud.',
        );
        setMapsReady(false);
        return;
      }

      autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
        componentRestrictions: { country: 'br' },
        fields: ['formatted_address', 'geometry', 'place_id', 'name', 'address_components'],
      });

      listener = autocomplete.addListener('place_changed', () => {
        if (!autocomplete) return;
        const place = autocomplete.getPlace();
        const lat = place.geometry?.location?.lat();
        const lng = place.geometry?.location?.lng();
        const formatted = place.formatted_address?.trim();
        if (lat == null || lng == null || !formatted) return;

        const venueName = inferVenueName(place);
        lastSelectedAddressRef.current = formatted;
        onChangeRef.current(formatted);
        onPlaceSelectRef.current({
          address: formatted,
          lat,
          lng,
          placeId: place.place_id ?? null,
          venueName,
        });
      });
    } catch (err: unknown) {
      setMapsReady(false);
      setMapsError(
        err instanceof Error
          ? err.message
          : 'Erro ao iniciar autocomplete do Google Maps. Digite o endereço manualmente.',
      );
      return;
    }

    return () => {
      detachAutocompleteListener(listener);
      autocomplete = null;
      listener = null;
    };
  }, [mapsReady, disabled, mapsConfigured]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    onChange(next);
    if (lastSelectedAddressRef.current && next.trim() !== lastSelectedAddressRef.current) {
      lastSelectedAddressRef.current = null;
      onGeoClear?.();
    }
  };

  const autocompleteUnavailable = Boolean(mapsError);

  return (
    <div className="space-y-1">
      <Input
        ref={inputRef}
        value={value}
        onChange={handleInputChange}
        disabled={disabled}
        placeholder={
          mapsConfigured && !autocompleteUnavailable
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
      {mapsError && (
        <p className="text-xs text-amber-500/90">
          {mapsError} Você ainda pode digitar o endereço manualmente.
        </p>
      )}
      {mapsConfigured && mapsReady && !mapsError && (
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

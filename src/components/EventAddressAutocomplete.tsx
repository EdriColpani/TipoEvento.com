import React, { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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

type AddressInputMode = 'manual' | 'google';

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

interface GooglePlacesAddressInputProps {
  initialValue: string;
  onChange: (address: string) => void;
  onPlaceSelect: (place: EventGeoSelection) => void;
  onGeoClear?: () => void;
  onSwitchManual: () => void;
  disabled?: boolean;
  placeholder: string;
  inputClassName: string;
}

/** Input isolado: ao desmontar, o Google Autocomplete deixa de interferir no DOM. */
const GooglePlacesAddressInput: React.FC<GooglePlacesAddressInputProps> = ({
  initialValue,
  onChange,
  onPlaceSelect,
  onGeoClear,
  onSwitchManual,
  disabled,
  placeholder,
  inputClassName,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const lastSelectedRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  const onPlaceSelectRef = useRef(onPlaceSelect);
  const onGeoClearRef = useRef(onGeoClear);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState<string | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onPlaceSelectRef.current = onPlaceSelect;
  }, [onPlaceSelect]);
  useEffect(() => {
    onGeoClearRef.current = onGeoClear;
  }, [onGeoClear]);

  useEffect(() => {
    if (disabled) return;
    let cancelled = false;

    loadGoogleMapsPlaces()
      .then(() => {
        if (!cancelled) setMapsReady(true);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setMapsError(err instanceof Error ? err.message : 'Google Maps indisponível.');
          onSwitchManual();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [disabled, onSwitchManual]);

  useEffect(() => {
    if (!mapsReady || !inputRef.current || disabled) return;

    let listener: google.maps.MapsEventListener | null = null;

    try {
      if (!google.maps?.places?.Autocomplete) {
        setMapsError('Google Places indisponível.');
        onSwitchManual();
        return;
      }

      const autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
        componentRestrictions: { country: 'br' },
        fields: ['formatted_address', 'geometry', 'place_id', 'name', 'address_components'],
      });

      listener = autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        const lat = place.geometry?.location?.lat();
        const lng = place.geometry?.location?.lng();
        const formatted = place.formatted_address?.trim();
        if (lat == null || lng == null || !formatted) return;

        lastSelectedRef.current = formatted;
        if (inputRef.current) inputRef.current.value = formatted;
        onChangeRef.current(formatted);
        onPlaceSelectRef.current({
          address: formatted,
          lat,
          lng,
          placeId: place.place_id ?? null,
          venueName: inferVenueName(place),
        });
      });
    } catch {
      setMapsError('Erro ao iniciar busca Google.');
      onSwitchManual();
      return;
    }

    return () => {
      detachAutocompleteListener(listener);
    };
  }, [mapsReady, disabled, onSwitchManual]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    onChangeRef.current(next);
    if (lastSelectedRef.current && next.trim() !== lastSelectedRef.current) {
      lastSelectedRef.current = null;
      onGeoClearRef.current?.();
    }
  };

  return (
    <div className="space-y-1">
      <Input
        ref={inputRef}
        defaultValue={initialValue}
        onChange={handleChange}
        onBlur={(e) => onChangeRef.current(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        name="event-address-google"
        className={inputClassName}
      />
      {!mapsReady && !mapsError && (
        <p className="text-xs text-gray-500 flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Carregando busca Google…
        </p>
      )}
      {mapsError && <p className="text-xs text-amber-500/90">{mapsError}</p>}
      {mapsReady && (
        <p className="text-xs text-gray-500">
          Escolha uma sugestão do Google ou{' '}
          <button
            type="button"
            className="text-yellow-500/90 underline underline-offset-2 hover:text-yellow-400"
            onClick={onSwitchManual}
          >
            digitar sem Google
          </button>
          .
        </p>
      )}
    </div>
  );
};

const EventAddressAutocomplete: React.FC<EventAddressAutocompleteProps> = ({
  value,
  onChange,
  onPlaceSelect,
  onGeoClear,
  disabled,
  placeholder = 'Digite e selecione o endereço no Google',
  inputClassName,
}) => {
  const mapsConfigured = isGoogleMapsConfigured();
  const [mode, setMode] = useState<AddressInputMode>(() => (mapsConfigured ? 'manual' : 'manual'));
  const lastSelectedRef = useRef<string | null>(null);

  const inputClass =
    inputClassName ??
    'bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500';

  const handleManualChange = (next: string) => {
    onChange(next);
    if (lastSelectedRef.current && next.trim() !== lastSelectedRef.current) {
      lastSelectedRef.current = null;
      onGeoClear?.();
    }
  };

  const switchToManual = () => setMode('manual');
  const switchToGoogle = () => setMode('google');

  if (mode === 'google' && mapsConfigured) {
    return (
      <div className="space-y-1">
        <GooglePlacesAddressInput
          key="google-places-input"
          initialValue={value}
          onChange={onChange}
          onPlaceSelect={(place) => {
            lastSelectedRef.current = place.address;
            onPlaceSelect(place);
          }}
          onGeoClear={onGeoClear}
          onSwitchManual={switchToManual}
          disabled={disabled}
          placeholder={placeholder}
          inputClassName={inputClass}
        />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Input
        value={value}
        onChange={(e) => handleManualChange(e.target.value)}
        disabled={disabled}
        placeholder="Ex: Rua Principal, 123 - Centro, Cidade - UF"
        autoComplete="street-address"
        name="event-address-manual"
        className={inputClass}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-xs text-gray-500">
          Digite livremente e use &quot;Confirmar no mapa&quot; abaixo.
        </p>
        {mapsConfigured && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs text-yellow-500"
            onClick={switchToGoogle}
          >
            Usar busca Google
          </Button>
        )}
      </div>
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

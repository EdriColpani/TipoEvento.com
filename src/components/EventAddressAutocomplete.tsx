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

/**
 * Google Places Autocomplete + digitação manual.
 * Input não controlado pelo React enquanto o autocomplete está ativo (evita bloquear teclas).
 */
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
  const onGeoClearRef = useRef(onGeoClear);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState(!isGoogleMapsConfigured());
  const mapsConfigured = isGoogleMapsConfigured();

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onPlaceSelectRef.current = onPlaceSelect;
  }, [onPlaceSelect]);

  useEffect(() => {
    onGeoClearRef.current = onGeoClear;
  }, [onGeoClear]);

  /** Sincroniza valor vindo do formulário (ex.: carregar evento) sem sobrescrever enquanto digita. */
  useEffect(() => {
    const el = inputRef.current;
    if (!el || document.activeElement === el) return;
    const next = value ?? '';
    if (el.value !== next) {
      el.value = next;
    }
  }, [value]);

  useEffect(() => {
    if (!mapsConfigured || disabled || manualMode) return;

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
          setManualMode(true);
          setMapsError(err instanceof Error ? err.message : 'Não foi possível carregar o Google Maps.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mapsConfigured, disabled, manualMode]);

  useEffect(() => {
    if (manualMode || !mapsReady || !inputRef.current || disabled || !mapsConfigured) return;

    let listener: google.maps.MapsEventListener | null = null;
    let autocomplete: google.maps.places.Autocomplete | null = null;

    try {
      if (!google.maps?.places?.Autocomplete) {
        setMapsError(
          'Google Places indisponível. Verifique a chave da API e os referrers autorizados no Google Cloud.',
        );
        setMapsReady(false);
        setManualMode(true);
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
        if (inputRef.current) inputRef.current.value = formatted;
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
      setManualMode(true);
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
  }, [mapsReady, disabled, mapsConfigured, manualMode]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    onChangeRef.current(next);
    if (lastSelectedAddressRef.current && next.trim() !== lastSelectedAddressRef.current) {
      lastSelectedAddressRef.current = null;
      onGeoClearRef.current?.();
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    onChangeRef.current(e.target.value);
  };

  const enableGoogleSearch = () => {
    setManualMode(false);
    setMapsError(null);
    setMapsReady(false);
  };

  const inputClass =
    inputClassName ??
    'bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500';

  return (
    <div className="space-y-1">
      <Input
        ref={inputRef}
        defaultValue={value}
        onChange={handleInputChange}
        onBlur={handleBlur}
        disabled={disabled}
        placeholder={
          manualMode || !mapsConfigured
            ? 'Ex: Rua Principal, 123 - Centro, Cidade - UF'
            : placeholder
        }
        autoComplete="off"
        className={inputClass}
      />

      {mapsConfigured && !manualMode && !mapsReady && !mapsError && (
        <p className="text-xs text-gray-500 flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Carregando busca de endereço…
        </p>
      )}

      {mapsError && (
        <p className="text-xs text-amber-500/90">
          {mapsError} Digite o endereço manualmente e use &quot;Confirmar no mapa&quot; abaixo.
        </p>
      )}

      {mapsConfigured && !manualMode && mapsReady && !mapsError && (
        <p className="text-xs text-gray-500">
          Digite normalmente e escolha uma sugestão do Google, ou{' '}
          <button
            type="button"
            className="text-yellow-500/90 underline underline-offset-2 hover:text-yellow-400"
            onClick={() => setManualMode(true)}
          >
            digitar sem Google
          </button>
          .
        </p>
      )}

      {mapsConfigured && manualMode && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-gray-500">
            Modo manual: digite o endereço completo e clique em &quot;Confirmar no mapa&quot;.
          </p>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs text-yellow-500"
            onClick={enableGoogleSearch}
          >
            Usar busca Google
          </Button>
        </div>
      )}

      {!mapsConfigured && (
        <p className="text-xs text-gray-500">
          Sem chave do Google Maps: digite o endereço completo e use &quot;Confirmar no mapa&quot;.
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

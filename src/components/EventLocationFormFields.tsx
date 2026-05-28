import React, { useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import EventAddressAutocomplete from '@/components/EventAddressAutocomplete';
import EventLocationMap from '@/components/EventLocationMap';
import {
  buildMapSearchQuery,
  geocodeBrazilAddress,
  isGoogleMapsConfigured,
} from '@/utils/google-maps';
import { Loader2, MapPin } from 'lucide-react';
import { showError } from '@/utils/toast';

/**
 * Campos de local + endereço com autocomplete Google (quando configurado) e preview do mapa.
 */
const EventLocationFormFields: React.FC = () => {
  const { control, setValue, watch, getValues } = useFormContext();
  const location = watch('location') as string;
  const address = watch('address') as string;
  const lat = watch('address_lat') as number | null | undefined;
  const lng = watch('address_lng') as number | null | undefined;
  const showPreview = Boolean((address ?? '').trim().length >= 5);
  const hasCoords = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
  const [geocoding, setGeocoding] = useState(false);

  const clearGeo = () => {
    setValue('address_lat', null, { shouldDirty: true });
    setValue('address_lng', null, { shouldDirty: true });
    setValue('address_place_id', null, { shouldDirty: true });
  };

  const applyGeocoded = (result: { address: string; lat: number; lng: number; placeId: string | null }) => {
    setValue('address', result.address, { shouldDirty: true });
    setValue('address_lat', result.lat, { shouldDirty: true });
    setValue('address_lng', result.lng, { shouldDirty: true });
    setValue('address_place_id', result.placeId, { shouldDirty: true });
  };

  const handleConfirmOnMap = async () => {
    const currentAddress = getValues('address')?.trim();
    const currentLocation = getValues('location')?.trim();
    if (!currentAddress) {
      showError('Informe o endereço antes de confirmar no mapa.');
      return;
    }

    setGeocoding(true);
    try {
      const geocoded = await geocodeBrazilAddress(
        buildMapSearchQuery({ address: currentAddress, location: currentLocation }),
      );
      if (!geocoded) {
        showError('Não foi possível localizar esse endereço. Selecione uma sugestão do Google ou revise o texto.');
        return;
      }
      applyGeocoded(geocoded);
    } finally {
      setGeocoding(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          control={control}
          name="location"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-white">Local do evento</FormLabel>
              <FormControl>
                <Input
                  placeholder="Ex: Arena Music Hall"
                  className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500"
                  {...field}
                />
              </FormControl>
              <FormDescription className="text-gray-500 text-xs">
                Nome do local (como aparece para o público).
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-white">Endereço completo</FormLabel>
              <FormControl>
                <EventAddressAutocomplete
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  onPlaceSelect={(place) => {
                    field.onChange(place.address);
                    setValue('address_lat', place.lat, { shouldDirty: true });
                    setValue('address_lng', place.lng, { shouldDirty: true });
                    setValue('address_place_id', place.placeId, { shouldDirty: true });
                    if (!getValues('location')?.trim() && place.venueName) {
                      setValue('location', place.venueName, { shouldDirty: true });
                    }
                  }}
                  onGeoClear={clearGeo}
                />
              </FormControl>
              {isGoogleMapsConfigured() && (
                <FormDescription className="text-gray-500 text-xs">
                  Busque e selecione o endereço na lista do Google.
                </FormDescription>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {showPreview && isGoogleMapsConfigured() && !hasCoords && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <p className="text-xs text-amber-200/90 flex-1">
            Endereço sem coordenadas fixadas. Confirme no mapa ou escolha uma sugestão do Google.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={geocoding}
            onClick={() => void handleConfirmOnMap()}
            className="border-amber-500/40 text-amber-200 hover:bg-amber-500/10 shrink-0"
          >
            {geocoding ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <MapPin className="h-4 w-4 mr-2" />
            )}
            Confirmar no mapa
          </Button>
        </div>
      )}

      {showPreview && (
        <div className="rounded-xl border border-yellow-500/20 bg-black/30 p-4">
          <p className="text-sm text-yellow-500/90 mb-3 font-medium">Pré-visualização do mapa</p>
          <EventLocationMap
            location={location || 'Local do evento'}
            address={address}
            lat={lat}
            lng={lng}
            mapHeightClass="h-40 sm:h-48"
            showAddressHeader={false}
            compact
          />
        </div>
      )}
    </div>
  );
};

export default EventLocationFormFields;

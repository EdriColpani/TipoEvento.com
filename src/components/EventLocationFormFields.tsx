import React from 'react';
import { useFormContext } from 'react-hook-form';
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import EventAddressAutocomplete from '@/components/EventAddressAutocomplete';
import EventLocationMap from '@/components/EventLocationMap';
import { isGoogleMapsConfigured } from '@/utils/google-maps';

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

  const clearGeo = () => {
    setValue('address_lat', null, { shouldDirty: true });
    setValue('address_lng', null, { shouldDirty: true });
    setValue('address_place_id', null, { shouldDirty: true });
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

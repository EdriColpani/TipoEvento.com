declare namespace google.maps.places {
  interface PlaceResult {
    formatted_address?: string;
    name?: string;
    place_id?: string;
    geometry?: {
      location?: {
        lat(): number;
        lng(): number;
      };
    };
    address_components?: Array<{
      long_name: string;
      short_name: string;
      types: string[];
    }>;
  }

  class Autocomplete {
    constructor(input: HTMLInputElement, opts?: { componentRestrictions?: { country: string | string[] }; fields?: string[] });
    addListener(event: string, handler: () => void): google.maps.MapsEventListener;
    getPlace(): PlaceResult;
  }
}

declare namespace google.maps {
  interface MapsEventListener {
    remove(): void;
  }

  namespace event {
    function removeListener(listener: MapsEventListener): void;
  }

  const places: { Autocomplete: typeof google.maps.places.Autocomplete };
}

interface Window {
  google?: {
    maps: typeof google.maps;
  };
}

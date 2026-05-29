import React, { useMemo } from 'react';
import { ExternalLink, Navigation } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  buildGoogleMapsDirectionsUrl,
  buildGoogleMapsOpenUrl,
  type EventMapQuery,
} from '@/utils/google-maps';
import { cn, outlineBtnDarkClass } from '@/lib/utils';

export interface EventLocationLinksProps extends EventMapQuery {
  className?: string;
  size?: 'sm' | 'default';
}

const EventLocationLinks: React.FC<EventLocationLinksProps> = ({
  location,
  address,
  lat,
  lng,
  className,
  size = 'sm',
}) => {
  const query: EventMapQuery = useMemo(
    () => ({ location, address, lat, lng }),
    [location, address, lat, lng],
  );

  const openUrl = buildGoogleMapsOpenUrl(query);
  const directionsUrl = buildGoogleMapsDirectionsUrl(query);

  if (!openUrl && !directionsUrl) return null;

  const btnClass = cn(
    outlineBtnDarkClass,
    size === 'sm' && 'h-8 px-2.5 text-xs',
  );

  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {directionsUrl && (
        <Button type="button" variant="outline" size={size} className={btnClass} asChild>
          <a href={directionsUrl} target="_blank" rel="noopener noreferrer">
            <Navigation className="h-3.5 w-3.5 mr-1.5" />
            Como chegar
          </a>
        </Button>
      )}
      {openUrl && (
        <Button type="button" variant="outline" size={size} className={btnClass} asChild>
          <a href={openUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
            Abrir no Maps
          </a>
        </Button>
      )}
    </div>
  );
};

export default EventLocationLinks;

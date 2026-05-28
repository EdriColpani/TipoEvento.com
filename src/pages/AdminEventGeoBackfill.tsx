import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Loader2, MapPin, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/hooks/use-profile';
import { showError, showSuccess } from '@/utils/toast';
import {
  buildMapSearchQuery,
  geocodeBrazilAddress,
  isGoogleMapsConfigured,
} from '@/utils/google-maps';

type MissingGeoEvent = {
  id: string;
  title: string;
  date: string | null;
  location: string | null;
  address: string | null;
  status: string | null;
};

const ADMIN_MASTER_USER_TYPE_ID = 1;

const AdminEventGeoBackfill: React.FC = () => {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | undefined>();
  const { profile, isLoading: loadingProfile } = useProfile(userId);
  const [items, setItems] = useState<MissingGeoEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; ok: number; fail: number } | null>(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('list_admin_events_missing_geo', {
        p_limit: 200,
        p_offset: 0,
      });
      if (error) throw error;
      const payload = (data ?? {}) as { items?: MissingGeoEvent[]; total?: number };
      setItems(payload.items ?? []);
      setTotal(Number(payload.total ?? 0));
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : 'Erro ao listar eventos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id));
  }, []);

  useEffect(() => {
    if (!loadingProfile && userId && profile?.tipo_usuario_id !== ADMIN_MASTER_USER_TYPE_ID) {
      showError('Acesso negado. Apenas Admin Master.');
      navigate('/manager/dashboard');
    }
  }, [loadingProfile, userId, profile?.tipo_usuario_id, navigate]);

  useEffect(() => {
    if (!loadingProfile && profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID) {
      void loadItems();
    }
  }, [loadingProfile, profile?.tipo_usuario_id, loadItems]);

  const runBackfill = async () => {
    if (!isGoogleMapsConfigured()) {
      showError('Configure VITE_GOOGLE_MAPS_API_KEY e habilite Geocoding API no Google Cloud.');
      return;
    }
    if (items.length === 0) {
      showSuccess('Nenhum evento pendente de geocodificação.');
      return;
    }

    setRunning(true);
    const stats = { done: 0, ok: 0, fail: 0 };
    setProgress({ ...stats });

    for (const event of items) {
      stats.done += 1;
      setProgress({ ...stats });

      const query = buildMapSearchQuery({
        address: event.address,
        location: event.location,
      });
      if (!query.trim()) {
        stats.fail += 1;
        continue;
      }

      try {
        const geocoded = await geocodeBrazilAddress(query);
        if (!geocoded) {
          stats.fail += 1;
          continue;
        }

        const { error } = await supabase.rpc('update_admin_event_geo', {
          p_event_id: event.id,
          p_address: geocoded.address,
          p_address_lat: geocoded.lat,
          p_address_lng: geocoded.lng,
          p_address_place_id: geocoded.placeId,
        });
        if (error) throw error;
        stats.ok += 1;
      } catch {
        stats.fail += 1;
      }

      setProgress({ ...stats });
      await new Promise((r) => window.setTimeout(r, 250));
    }

    setRunning(false);
    showSuccess(`Geocodificação concluída: ${stats.ok} ok, ${stats.fail} falha(s).`);
    await loadItems();
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif text-yellow-500">Geocodificar eventos</h1>
          <p className="text-gray-400 text-sm mt-1">
            Eventos com endereço texto mas sem latitude/longitude (legado).
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => navigate('/admin/dashboard')}
          className="border-yellow-500/30 text-yellow-500"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Voltar
        </Button>
      </div>

      <Card className="bg-black/60 border-yellow-500/20">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <MapPin className="h-5 w-5 text-yellow-500" />
            Pendências ({total})
          </CardTitle>
          <CardDescription className="text-gray-400">
            Usa Geocoding API no navegador (mesma chave do cadastro). Processe em lotes pequenos se houver muitos eventos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={running || loading || items.length === 0}
              onClick={() => void runBackfill()}
              className="bg-yellow-500 text-black hover:bg-yellow-600"
            >
              {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <MapPin className="h-4 w-4 mr-2" />}
              Geocodificar pendentes ({items.length})
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={running || loading}
              onClick={() => void loadItems()}
              className="border-yellow-500/30 text-yellow-500"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Atualizar lista
            </Button>
          </div>

          {progress && running && (
            <p className="text-sm text-gray-400">
              Processando… {progress.done}/{items.length} ({progress.ok} ok, {progress.fail} falhas)
            </p>
          )}

          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-8 w-8 animate-spin text-yellow-500" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-gray-500 text-sm">Nenhum evento pendente.</p>
          ) : (
            <ul className="space-y-2 max-h-96 overflow-y-auto">
              {items.map((ev) => (
                <li
                  key={ev.id}
                  className="rounded-lg border border-yellow-500/15 bg-black/40 px-3 py-2 text-sm"
                >
                  <p className="text-white font-medium">{ev.title}</p>
                  <p className="text-gray-400 text-xs mt-1">
                    {ev.location ? `${ev.location} · ` : ''}
                    {ev.address}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminEventGeoBackfill;

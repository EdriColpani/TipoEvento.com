import React, { useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import QRCode from 'react-qr-code';
import { Button } from '@/components/ui/button';

interface SuccessLocationState {
  qrCode?: string;
  eventTitle?: string;
  eventDate?: string;
  eventTime?: string;
  eventLocation?: string;
  email?: string;
}

const EventInscriptionSuccessPage: React.FC = () => {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state || {}) as SuccessLocationState;

  const qrCode = state.qrCode;
  const eventTitle = state.eventTitle || 'Evento';
  const eventDate = state.eventDate || '';
  const eventTime = state.eventTime || '';
  const eventLocation = state.eventLocation || '';
  const email = state.email || '';

  const hasBasicInfo = !!qrCode && !!eventId;

  useEffect(() => {
    const sendEmail = async () => {
      if (!qrCode || !email) return;
      const url = import.meta.env.VITE_SUPABASE_URL;
      const anon =
        import.meta.env.VITE_SUPABASE_ANON_KEY ||
        import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      if (!url || !anon) {
        console.warn('send-free-registration-email: URL/anon ausentes no build');
        return;
      }
      try {
        // fetch + anon no header evita 401 do gateway (invoke sem sessão falha em muitos deploys)
        const res = await fetch(`${url}/functions/v1/send-free-registration-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${anon}`,
            apikey: anon,
          },
          body: JSON.stringify({
            qrCode,
            email,
            eventTitle,
            eventDate,
            eventTime,
            eventLocation,
          }),
        });
        const r = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          error?: string;
        };
        if (!res.ok && res.status === 401) {
          console.warn(
            'send-free-registration-email 401: no Dashboard desligue Verify JWT nesta função e faça deploy --no-verify-jwt',
          );
          return;
        }
        if (r.success === false) {
          console.warn('E-mail não enviado:', r.error, r);
        }
      } catch {
        /* inscrição já ok na tela */
      }
    };
    sendEmail();
  }, [qrCode, email, eventTitle, eventDate, eventTime, eventLocation]);

  return (
    <div className="min-h-screen bg-black text-white px-4 py-8 flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="bg-black/80 border border-yellow-500/30 rounded-2xl p-6 sm:p-8 text-center">
          <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 font-bold mb-3">
            Inscrição confirmada!
          </h1>
          <p className="text-gray-300 text-sm sm:text-base mb-4">
            Você está inscrito no evento{' '}
            <span className="font-semibold text-yellow-400">{eventTitle}</span>.
          </p>

          {(eventDate || eventTime || eventLocation) && (
            <p className="text-gray-400 text-xs sm:text-sm mb-6">
              Data: <span className="text-yellow-400">{eventDate || 'A definir'}</span>
              {eventTime && <> · Horário: <span className="text-yellow-400">{eventTime}</span></>}
              {eventLocation && (
                <>
                  <br />
                  Local: <span className="text-yellow-400">{eventLocation}</span>
                </>
              )}
            </p>
          )}

          {hasBasicInfo ? (
            <>
              <div className="flex flex-col items-center mb-6">
                <div className="bg-white p-4 rounded-xl inline-block">
                  <QRCode
                    value={qrCode}
                    size={180}
                    fgColor="#000000"
                    bgColor="#ffffff"
                  />
                </div>
                <p className="text-gray-400 text-xs sm:text-sm mt-4 max-w-xs">
                  Este é o seu <span className="text-yellow-400 font-semibold">ingresso digital</span>.
                  Apresente este QR Code no dia do evento para entrar.
                </p>
              </div>

              <p className="text-gray-400 text-xs sm:text-sm mb-6">
                Enviaremos os detalhes do evento e este mesmo QR Code para o e-mail{' '}
                <span className="text-yellow-400 font-semibold break-all">
                  {email || 'informado na inscrição'}
                </span>.
              </p>
            </>
          ) : (
            <p className="text-gray-400 text-sm mb-6">
              Sua inscrição foi registrada. Caso não veja o QR Code, volte para a lista de eventos e tente novamente.
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              className="bg-yellow-500 text-black hover:bg-yellow-600 min-h-[44px] px-6"
              onClick={() => navigate('/')}
            >
              Voltar para a Home
            </Button>
            <Button
              variant="outline"
              className="border-yellow-500/40 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/15 min-h-[44px] px-6"
              onClick={() => navigate(`/events/${eventId}`)}
            >
              Ver detalhes do evento
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EventInscriptionSuccessPage;


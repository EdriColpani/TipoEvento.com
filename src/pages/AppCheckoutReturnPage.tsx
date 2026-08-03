import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Ponte HTTPS → app nativo após checkout Mercado Pago.
 * Precisa ficar FORA do ClientAuthGate: o Chrome aberto pelo MP muitas vezes
 * não tem a sessão do app, e /tickets redirecionava para login sem abrir o deep link.
 */
export default function AppCheckoutReturnPage() {
  const [params] = useSearchParams();
  const [tried, setTried] = useState(false);

  const statusRaw = (params.get('status') ?? 'pending').toLowerCase();
  const status =
    statusRaw === 'success' || statusRaw === 'pending' || statusRaw === 'failure'
      ? statusRaw
      : 'pending';
  const transactionId = (params.get('transaction_id') ?? '').trim();
  const topupId = (params.get('topup_id') ?? '').trim();
  const kind = topupId ? 'credit' : 'ticket';

  const deepLink = useMemo(() => {
    if (kind === 'credit' && topupId) {
      return (
        `eventfest://wallet?topupId=${encodeURIComponent(topupId)}` +
        `&returnStatus=${encodeURIComponent(status)}`
      );
    }
    if (transactionId) {
      return (
        `eventfest://checkout/return?transactionId=${encodeURIComponent(transactionId)}` +
        `&returnStatus=${encodeURIComponent(status)}`
      );
    }
    return 'eventfest://tickets';
  }, [kind, topupId, transactionId, status]);

  const androidIntent = useMemo(() => {
    if (kind === 'credit' && topupId) {
      const path =
        `wallet?topupId=${encodeURIComponent(topupId)}&returnStatus=${encodeURIComponent(status)}`;
      return `intent://${path}#Intent;scheme=eventfest;package=com.eventfest.rush;end`;
    }
    if (transactionId) {
      const path =
        `checkout/return?transactionId=${encodeURIComponent(transactionId)}&returnStatus=${encodeURIComponent(status)}`;
      return `intent://${path}#Intent;scheme=eventfest;package=com.eventfest.rush;end`;
    }
    return 'intent://tickets#Intent;scheme=eventfest;package=com.eventfest.rush;end';
  }, [kind, topupId, transactionId, status]);

  useEffect(() => {
    setTried(true);
    // 1) scheme custom
    window.location.href = deepLink;
    // 2) Android Intent (fallback curto)
    const t = window.setTimeout(() => {
      const ua = navigator.userAgent || '';
      if (/Android/i.test(ua)) {
        window.location.href = androidIntent;
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [deepLink, androidIntent]);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6 gap-4">
      <h1 className="text-2xl font-extrabold text-yellow-400">EventFest Rush</h1>
      <p className="text-center text-gray-300 max-w-md">
        {tried
          ? 'Abrindo o aplicativo… Se nada acontecer, toque no botão abaixo.'
          : 'Preparando retorno ao app…'}
      </p>
      <a
        href={deepLink}
        className="inline-flex items-center justify-center rounded-xl bg-yellow-500 px-5 py-3 font-bold text-black hover:bg-yellow-400"
      >
        Abrir no EventFest Rush
      </a>
      <a
        href={androidIntent}
        className="text-sm text-yellow-500/90 underline underline-offset-2"
      >
        Alternativa Android
      </a>
      <p className="text-xs text-gray-500 text-center max-w-sm mt-4">
        Se estiver testando no Expo Go, o deep link pode não abrir. Use o alternador de apps e volte
        ao EventFest Rush manualmente — a compra pendente será conferida lá.
      </p>
    </div>
  );
}

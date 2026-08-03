import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent);
}

/**
 * Ponte HTTPS → app após checkout Mercado Pago.
 * Fora do ClientAuthGate (Chrome/Safari do MP não carrega a sessão web).
 *
 * iOS: NÃO redireciona automaticamente para eventfest:// — o Safari mostra
 * “endereço inválido” no Expo Go / sem build nativo instalado.
 */
export default function AppCheckoutReturnPage() {
  const [params] = useSearchParams();
  const ios = isIOS();
  const android = isAndroid();
  const [copied, setCopied] = useState(false);

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

  const statusLabel =
    status === 'success'
      ? 'Pagamento aprovado'
      : status === 'failure'
        ? 'Pagamento não concluído'
        : 'Pagamento em análise';

  useEffect(() => {
    // Só Android tenta abrir automaticamente (Intent). No iOS o auto-redirect
    // para eventfest:// gera o alerta “endereço inválido” do Safari.
    if (!android) return;
    const t = window.setTimeout(() => {
      window.location.href = androidIntent;
    }, 250);
    return () => window.clearTimeout(t);
  }, [android, androidIntent]);

  const openApp = () => {
    if (android) {
      window.location.href = androidIntent;
      window.setTimeout(() => {
        window.location.href = deepLink;
      }, 600);
      return;
    }
    // iOS: só por gesto do usuário; se o app nativo não estiver instalado, o Safari
    // ainda pode reclamar — por isso o texto pede o alternador de apps.
    window.location.href = deepLink;
  };

  const copyHint = async () => {
    try {
      await navigator.clipboard.writeText('Abra o EventFest Rush para confirmar seu ingresso.');
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6 gap-4">
      <h1 className="text-2xl font-extrabold text-cyan-400">EventFest Rush</h1>
      <p className="text-center text-yellow-400 font-semibold text-lg">{statusLabel}</p>

      {ios ? (
        <div className="max-w-md space-y-3 text-center">
          <p className="text-gray-200 text-base leading-relaxed">
            No iPhone o Mercado Pago abre o Safari. Para voltar ao app:
          </p>
          <ol className="text-left text-gray-300 text-sm space-y-2 list-decimal list-inside">
            <li>Toque no botão de apps recentes (gesto para cima e segure, ou botão home). </li>
            <li>Selecione <strong className="text-white">EventFest Rush</strong> ou Expo Go.</li>
            <li>O app confirma o pagamento automaticamente em alguns segundos.</li>
          </ol>
          <p className="text-xs text-gray-500 leading-relaxed">
            O link <span className="text-gray-400">eventfest://</span> só funciona com o app
            instalado pela loja/build nativo — no Expo Go o Safari mostra “endereço inválido”.
          </p>
        </div>
      ) : (
        <p className="text-center text-gray-300 max-w-md">
          Toque abaixo para voltar ao aplicativo. Se nada abrir, use o alternador de apps.
        </p>
      )}

      <button
        type="button"
        onClick={openApp}
        className="inline-flex items-center justify-center rounded-xl bg-cyan-400 px-5 py-3 font-bold text-black hover:bg-cyan-300"
      >
        Tentar abrir o EventFest Rush
      </button>

      {android ? (
        <a
          href={androidIntent}
          className="text-sm text-yellow-500/90 underline underline-offset-2"
        >
          Alternativa Android
        </a>
      ) : null}

      <button
        type="button"
        onClick={() => void copyHint()}
        className="text-xs text-gray-500 underline underline-offset-2"
      >
        {copied ? 'Lembrete copiado' : 'Copiar lembrete'}
      </button>

      {(transactionId || topupId) && (
        <p className="text-[11px] text-gray-600 text-center mt-2">
          Ref: {(transactionId || topupId).slice(0, 8)}…
        </p>
      )}
    </div>
  );
}

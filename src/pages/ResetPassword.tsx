import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { showError, showSuccess } from '@/utils/toast';

/**
 * Destino do link do e-mail de recovery (resetPasswordForEmail).
 * O Supabase redireciona com #access_token=...&type=recovery; o client persiste a sessão.
 */
const ResetPassword = () => {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [validSession, setValidSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      setValidSession(!!session);
      setReady(true);
    };

    run();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) setValidSession(!!session);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      showError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (password !== confirm) {
      showError('As senhas não conferem.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      showError(error.message || 'Não foi possível atualizar a senha.');
      return;
    }
    showSuccess('Senha atualizada. Entre de novo com a nova senha.');
    await supabase.auth.signOut({ scope: 'local' });
    try {
      window.history.replaceState(null, '', `${window.location.origin}/login`);
    } catch {
      /* ignore */
    }
    navigate('/login', { replace: true });
  };

  const inputClass =
    'w-full bg-black/60 border border-cyan-500/30 rounded-xl px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-cyan-400 focus:ring-cyan-400/25 transition-all duration-300';

  if (!ready) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (!validSession) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center px-4 py-12">
        <div className="absolute inset-0 opacity-[0.12] pointer-events-none">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                'radial-gradient(circle at 25% 25%, #22d3ee 0%, transparent 50%), radial-gradient(circle at 75% 75%, #3b82f6 0%, transparent 50%)',
              backgroundSize: '400px 400px',
            }}
          />
        </div>
        <div className="relative z-10 w-full max-w-md bg-black/80 backdrop-blur-sm border border-cyan-500/30 rounded-2xl p-8 text-center shadow-2xl shadow-cyan-500/15">
          <h1 className="text-xl font-semibold mb-2">Link inválido ou expirado</h1>
          <p className="text-gray-400 text-sm mb-6">
            Peça um novo link em &quot;Esqueci minha senha&quot; e abra o e-mail no navegador.
          </p>
          <Button
            className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-black hover:from-cyan-400 hover:to-blue-500 py-3 font-semibold"
            onClick={() => navigate('/forgot-password')}
          >
            Solicitar novo link
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center px-4 py-12">
      <div className="absolute inset-0 opacity-[0.12] pointer-events-none">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle at 25% 25%, #22d3ee 0%, transparent 50%), radial-gradient(circle at 75% 75%, #3b82f6 0%, transparent 50%)',
            backgroundSize: '400px 400px',
          }}
        />
      </div>
      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-6">
          <div className="text-3xl font-serif font-bold mb-2 bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-500 bg-clip-text text-transparent">
            EventFest
          </div>
          <h1 className="text-2xl font-semibold">Nova senha</h1>
          <p className="text-gray-400 text-sm mt-1">
            Link de recuperação ativo — não é login normal. Defina a nova senha e depois entre de novo.
          </p>
        </div>
        <form
          onSubmit={handleSubmit}
          className="bg-black/80 backdrop-blur-sm border border-cyan-500/30 rounded-2xl p-8 space-y-4 shadow-2xl shadow-cyan-500/15"
        >
          <div>
            <label htmlFor="np" className="block text-sm text-white mb-2">
              Nova senha
            </label>
            <input
              id="np"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              required
              minLength={6}
            />
          </div>
          <div>
            <label htmlFor="npc" className="block text-sm text-white mb-2">
              Confirmar senha
            </label>
            <input
              id="npc"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputClass}
              required
              minLength={6}
            />
          </div>
          <Button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-black hover:from-cyan-400 hover:to-blue-500 py-3 font-semibold disabled:opacity-50"
          >
            {loading ? 'Salvando…' : 'Salvar nova senha'}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default ResetPassword;

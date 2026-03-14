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
      // Dar tempo ao client para processar hash da URL (recovery)
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
    showSuccess('Senha atualizada. Faça login com a nova senha.');
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  };

  if (!ready) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-yellow-500/30 border-t-yellow-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!validSession) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center px-4">
        <div className="w-full max-w-md bg-black/80 border border-yellow-500/30 rounded-2xl p-8 text-center">
          <h1 className="text-xl font-semibold mb-2">Link inválido ou expirado</h1>
          <p className="text-gray-400 text-sm mb-6">
            Peça um novo link em &quot;Esqueci minha senha&quot; e abra o e-mail no navegador.
          </p>
          <Button
            className="w-full bg-yellow-500 text-black hover:bg-yellow-600"
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
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="text-3xl font-serif text-yellow-500 font-bold mb-2">EventoFest</div>
          <h1 className="text-2xl font-semibold">Nova senha</h1>
          <p className="text-gray-400 text-sm mt-1">Defina uma senha nova para sua conta.</p>
        </div>
        <form
          onSubmit={handleSubmit}
          className="bg-black/80 border border-yellow-500/30 rounded-2xl p-8 space-y-4"
        >
          <div>
            <label htmlFor="np" className="block text-sm text-white mb-2">Nova senha</label>
            <input
              id="np"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-black/60 border border-yellow-500/30 rounded-xl px-4 py-3 text-white"
              required
              minLength={6}
            />
          </div>
          <div>
            <label htmlFor="npc" className="block text-sm text-white mb-2">Confirmar senha</label>
            <input
              id="npc"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full bg-black/60 border border-yellow-500/30 rounded-xl px-4 py-3 text-white"
              required
              minLength={6}
            />
          </div>
          <Button
            type="submit"
            disabled={loading}
            className="w-full bg-yellow-500 text-black hover:bg-yellow-600 py-3 font-semibold"
          >
            {loading ? 'Salvando…' : 'Salvar nova senha'}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default ResetPassword;

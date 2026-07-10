import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { signWalletQrToken, verifyWalletQrToken } from '../_shared/wallet-qr-token.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const supabaseService = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);
const WALLET_QR_PREFIX = 'EFW.';

function maskClientLabel(email: string | null | undefined, fullName: string | null | undefined): string {
  if (fullName?.trim()) {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length >= 2) return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
    return parts[0];
  }
  if (email?.includes('@')) {
    const [local, domain] = email.split('@');
    return `${local.slice(0, 2)}***@${domain}`;
  }
  return 'Cliente EventFest';
}

function profileDisplayName(row: {
  first_name?: string | null;
  last_name?: string | null;
} | null): string | null {
  if (!row) return null;
  const name = `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim();
  return name || null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Não autorizado.' }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  const supabaseAnon = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: userError } = await supabaseAnon.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Sessão inválida.' }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const rawInput = typeof body.walletToken === 'string' ? body.walletToken.trim() : '';
    const establishmentId = typeof body.establishmentId === 'string' ? body.establishmentId.trim() : '';

    if (!rawInput || !establishmentId) {
      return new Response(JSON.stringify({ error: 'Informe o QR/código da carteira e o estabelecimento.' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    let resolvedUserId: string | null = null;
    let normalizedWalletToken = '';
    let profileName: string | null = null;

    const looksLikeWalletQr = rawInput.toUpperCase().startsWith(WALLET_QR_PREFIX);
    if (looksLikeWalletQr) {
      const verified = await verifyWalletQrToken(rawInput);
      if (!verified.ok) {
        return new Response(JSON.stringify({ error: verified.message, errorCode: verified.error_code }), {
          status: verified.error_code === 'qr_expired' ? 409 : 400,
          headers: corsHeaders,
        });
      }
      resolvedUserId = verified.userId;
      normalizedWalletToken = rawInput;
    } else {
      // Código público do cliente — eq + UPPER evita ILIKE (lento / sem índice).
      const code = rawInput.toUpperCase();
      const { data: profileByCode, error: profileByCodeErr } = await supabaseService
        .from('profiles')
        .select('id, first_name, last_name')
        .eq('tipo_usuario_id', 3)
        .eq('public_id', code)
        .maybeSingle();
      if (profileByCodeErr) throw profileByCodeErr;

      if (!profileByCode?.id) {
        return new Response(JSON.stringify({ error: 'Código do cliente não encontrado.' }), {
          status: 404,
          headers: corsHeaders,
        });
      }

      resolvedUserId = profileByCode.id as string;
      profileName = profileDisplayName(profileByCode);
      const signed = await signWalletQrToken(resolvedUserId);
      normalizedWalletToken = signed.token;
    }

    // PDV + saldo em paralelo (antes eram sequenciais).
    const [pdvRes, accountRes, profileRes] = await Promise.all([
      supabaseAnon.rpc('get_establishment_pdv_context', {
        p_establishment_id: establishmentId,
      }),
      supabaseService
        .from('client_credit_accounts')
        .select('balance_cached, status, currency')
        .eq('user_id', resolvedUserId)
        .maybeSingle(),
      profileName
        ? Promise.resolve({ data: null, error: null })
        : supabaseService
            .from('profiles')
            .select('first_name, last_name')
            .eq('id', resolvedUserId)
            .maybeSingle(),
    ]);

    if (pdvRes.error) throw pdvRes.error;
    if (!pdvRes.data?.ready) {
      return new Response(
        JSON.stringify({ error: 'Este ponto de venda não está habilitado para crédito EventFest.' }),
        { status: 403, headers: corsHeaders },
      );
    }

    if (accountRes.error) throw accountRes.error;
    const account = accountRes.data;

    if (!profileName && profileRes.data) {
      profileName = profileDisplayName(
        profileRes.data as { first_name?: string | null; last_name?: string | null },
      );
    }

    if (account?.status && account.status !== 'active') {
      return new Response(JSON.stringify({ error: 'Carteira do cliente não está ativa.' }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        clientUserId: resolvedUserId,
        walletToken: normalizedWalletToken,
        balance: Number(account?.balance_cached ?? 0),
        currency: account?.currency ?? 'BRL',
        clientLabel: maskClientLabel(undefined, profileName),
      }),
      { status: 200, headers: corsHeaders },
    );
  } catch (err) {
    console.error('[resolve-wallet-qr]', err);
    const message = err instanceof Error ? err.message : 'Erro interno.';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});

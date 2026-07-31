-- O hardening anterior revogou credit_refund_to_wallet de authenticated, mas o
-- estorno de credito e disparado pelo painel Admin com o JWT do usuario (a RPC
-- valida o papel internamente). Sem este grant o botao de estorno quebra.

GRANT EXECUTE ON FUNCTION public.credit_refund_to_wallet(UUID, NUMERIC, TEXT, TEXT) TO authenticated;

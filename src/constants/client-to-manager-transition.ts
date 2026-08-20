/** Texto do aviso quando um cliente logado inicia cadastro de gestor. */
export const CLIENT_TO_MANAGER_TRANSITION = {
    title: 'Sair do perfil de cliente para gestor',
    lead:
        'Você está iniciando o cadastro de gestor EventFest com a mesma conta que usa hoje como cliente. Leia com atenção antes de continuar.',
    irreversible:
        'Esta mudança não pode ser desfeita por você na plataforma. Voltar a ser apenas cliente exige contato com o suporte EventFest.',
    bullets: [
        'Sua conta será promovida a Gestor PRO ao avançar no cadastro (Pessoa Física ou Jurídica).',
        'Após a promoção, o login abrirá o painel do gestor — não mais a experiência padrão de cliente.',
        'O menu muda: atalhos como Carteira EventFest e Meus Ingressos deixam de ser o padrão no avatar.',
        'Saldo na Carteira EventFest permanece vinculado a esta conta, mas o uso como cliente deixa de ser o fluxo principal.',
        'Será necessário cadastrar empresa, assinar contratos (OTP por e-mail) e escolher um plano de gestor.',
        'Ingressos já comprados como cliente continuam na conta; criar e operar eventos passa pelo painel de gestor.',
    ],
    tip: 'Para testes, prefira outro e-mail exclusivo para gestor e mantenha esta conta só como cliente.',
    cancel: 'Cancelar — continuar como cliente',
    confirm: 'Entendi, continuar cadastro de gestor',
} as const;

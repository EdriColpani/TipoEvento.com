export type FaqItem = { question: string; answer: string };

export const LANDING_ABOUT_CONTENT = `
A EventFest é a plataforma premium para descobrir, divulgar e vender experiências ao vivo.
Conectamos promotores, empresas e público em um ambiente seguro, moderno e focado em eventos memoráveis.

Nossa missão é simplificar a jornada do organizador — do cadastro do evento à venda de ingressos — e oferecer ao visitante uma vitrine clara, com informações completas e compra confiável.
`.trim();

export const LANDING_HOW_IT_WORKS = [
    {
        title: '1. Explore eventos',
        body: 'Navegue por categorias, filtros e destaques na página inicial. Encontre shows, festivais, workshops e muito mais.',
    },
    {
        title: '2. Escolha seus ingressos',
        body: 'Na página do evento, veja descrição, destaques, localização no mapa e tipos de ingresso disponíveis.',
    },
    {
        title: '3. Compre com segurança',
        body: 'Finalize a compra com Mercado Pago ou, quando disponível, créditos EventFest. Seus ingressos ficam em Meus Ingressos.',
    },
    {
        title: '4. Seja promotor',
        body: 'Gestores cadastram eventos, definem lotes, publicam na vitrine e acompanham vendas pelo painel administrativo.',
    },
];

export type LandingTermsSection = {
    title: string;
    paragraphs?: string[];
    listIntro?: string;
    bullets?: string[];
    paragraphsAfter?: string[];
    listIntro2?: string;
    bullets2?: string[];
};

export const LANDING_TERMS_SECTIONS: LandingTermsSection[] = [
    {
        title: '1. SOBRE A PLATAFORMA',
        paragraphs: [
            'A EventFest é uma plataforma digital destinada à divulgação, gerenciamento, organização e participação em eventos, oferecendo recursos para usuários, organizadores e parceiros.',
        ],
    },
    {
        title: '2. ACEITAÇÃO DOS TERMOS',
        paragraphs: [
            'Ao acessar, navegar ou utilizar qualquer funcionalidade da plataforma, o usuário declara que:',
        ],
        bullets: [
            'Leu e compreendeu estes Termos;',
            'Concorda integralmente com as condições aqui descritas;',
            'Possui capacidade legal para aceitar este contrato.',
        ],
        paragraphsAfter: [
            'Caso não concorde com qualquer condição, o uso da plataforma deve ser interrompido imediatamente.',
        ],
    },
    {
        title: '3. CADASTRO E RESPONSABILIDADES DO USUÁRIO',
        paragraphs: [
            'Para utilizar determinadas funcionalidades, poderá ser necessário criar uma conta.',
        ],
        listIntro: 'O usuário se compromete a:',
        bullets: [
            'Fornecer informações verdadeiras e atualizadas;',
            'Manter a confidencialidade de suas credenciais;',
            'Não compartilhar sua conta com terceiros;',
            'Responsabilizar-se por toda atividade realizada em sua conta.',
        ],
        listIntro2: 'A EventFest poderá suspender ou remover contas que apresentem:',
        bullets2: [
            'Informações falsas;',
            'Uso indevido da plataforma;',
            'Violação destes Termos.',
        ],
    },
    {
        title: '4. USO DA PLATAFORMA',
        listIntro: 'É proibido utilizar a EventFest para:',
        bullets: [
            'Atividades ilegais;',
            'Divulgação de conteúdo ofensivo, discriminatório ou fraudulento;',
            'Violação de direitos autorais;',
            'Tentativas de invasão, exploração de falhas ou ataques ao sistema;',
            'Spam, phishing ou práticas abusivas.',
        ],
        listIntro2: 'O descumprimento poderá resultar em:',
        bullets2: [
            'Suspensão imediata;',
            'Remoção de conteúdo;',
            'Encerramento da conta;',
            'Medidas legais cabíveis.',
        ],
    },
    {
        title: '5. EVENTOS E RESPONSABILIDADE DOS ORGANIZADORES',
        listIntro: 'Os organizadores são integralmente responsáveis por:',
        bullets: [
            'Informações publicadas;',
            'Cumprimento das leis aplicáveis;',
            'Realização dos eventos;',
            'Venda de ingressos e atendimento ao público.',
        ],
        listIntro2: 'A EventFest atua apenas como plataforma intermediadora e não se responsabiliza por:',
        bullets2: [
            'Cancelamentos;',
            'Alterações de datas;',
            'Problemas operacionais dos eventos;',
            'Condutas de organizadores ou participantes.',
        ],
    },
    {
        title: '6. PAGAMENTOS E REEMBOLSOS',
        listIntro: 'Pagamentos realizados na plataforma poderão estar sujeitos a:',
        bullets: [
            'Taxas operacionais;',
            'Políticas específicas do evento;',
            'Prazos de processamento bancário.',
        ],
        listIntro2: 'Solicitações de reembolso deverão seguir:',
        bullets2: [
            'As políticas definidas pelo organizador;',
            'A legislação aplicável;',
            'As regras informadas no momento da compra.',
        ],
    },
    {
        title: '7. PROPRIEDADE INTELECTUAL',
        paragraphs: ['Todo o conteúdo da plataforma, incluindo:'],
        bullets: [
            'Marca;',
            'Logotipo;',
            'Layout;',
            'Textos;',
            'Design;',
            'Funcionalidades;',
            'Código-fonte;',
        ],
        paragraphsAfter: [
            'é protegido por direitos autorais e propriedade intelectual.',
            'É proibida a reprodução, cópia ou utilização sem autorização prévia da EventFest.',
        ],
    },
    {
        title: '8. PRIVACIDADE E DADOS',
        paragraphs: [
            'O tratamento de dados pessoais ocorre conforme nossa Política de Privacidade.',
            'Ao utilizar a plataforma, o usuário concorda com:',
        ],
        bullets: [
            'Coleta de dados necessários para operação;',
            'Uso de cookies e tecnologias similares;',
            'Processamento de informações para melhoria da experiência.',
        ],
    },
    {
        title: '9. DISPONIBILIDADE DA PLATAFORMA',
        paragraphs: [
            'A EventFest busca manter seus serviços disponíveis continuamente, porém não garante funcionamento ininterrupto.',
            'Poderão ocorrer:',
        ],
        bullets: [
            'Manutenções;',
            'Atualizações;',
            'Instabilidades temporárias;',
            'Interrupções técnicas.',
        ],
    },
    {
        title: '10. LIMITAÇÃO DE RESPONSABILIDADE',
        listIntro: 'A EventFest não será responsável por:',
        bullets: [
            'Perdas indiretas;',
            'Lucros cessantes;',
            'Danos decorrentes do uso da plataforma;',
            'Falhas causadas por terceiros;',
            'Problemas externos de internet ou hospedagem.',
        ],
        paragraphs: ['O uso da plataforma ocorre por conta e risco do usuário.'],
    },
    {
        title: '11. MODIFICAÇÕES DOS TERMOS',
        paragraphs: [
            'A EventFest poderá atualizar estes Termos a qualquer momento.',
            'As alterações entrarão em vigor após publicação na plataforma.',
            'O uso contínuo da plataforma após alterações representa concordância com os novos termos.',
        ],
    },
    {
        title: '12. ENCERRAMENTO DE CONTA',
        paragraphs: ['O usuário poderá solicitar exclusão de sua conta a qualquer momento.'],
        listIntro: 'A EventFest também poderá:',
        bullets: [
            'Suspender;',
            'Limitar;',
            'Encerrar contas que violem estes Termos ou comprometam a segurança da plataforma.',
        ],
    },
    {
        title: '13. LEGISLAÇÃO APLICÁVEL',
        paragraphs: [
            'Este documento será regido pelas leis da República Federativa do Brasil.',
            'Fica eleito o foro da comarca competente da sede da EventFest para resolução de eventuais conflitos.',
        ],
    },
    {
        title: '14. CONTATO',
        paragraphs: ['Em caso de dúvidas, suporte ou solicitações:'],
        bullets: [
            'EventFest',
            'Email: contato@eventfest.com',
            'Instagram e demais canais oficiais no rodapé do site.',
        ],
    },
];

export const LANDING_PRIVACY_CONTENT = `
Política de Privacidade (resumo)

Coletamos dados necessários para cadastro, compra de ingressos e suporte (nome, e-mail, telefone, CPF quando aplicável).
Pagamentos são processados por parceiros certificados; não armazenamos dados completos de cartão.

Utilizamos suas informações para autenticação, emissão de ingressos, comunicações sobre eventos e melhoria da plataforma.
Você pode solicitar atualização ou exclusão de dados entrando em contato pelo formulário da landing ou canais oficiais.

Não vendemos seus dados pessoais. Medidas técnicas e contratuais protegem o acesso aos sistemas da EventFest.
`.trim();

export const LANDING_HELP_CENTER_SECTIONS = [
    {
        title: 'Conta e acesso',
        items: [
            'Crie sua conta em Cadastro e faça login para comprar ingressos.',
            'Esqueceu a senha? Use Recuperar senha na tela de login.',
            'Atualize perfil e documentos em Minha conta.',
        ],
    },
    {
        title: 'Ingressos',
        items: [
            'Ingressos comprados aparecem em Meus Ingressos com QR para entrada.',
            'Eventos gratuitos podem exigir inscrição com dados pessoais.',
            'Em caso de erro no pagamento, aguarde alguns minutos e verifique o status.',
        ],
    },
    {
        title: 'Gestores e empresas',
        items: [
            'Cadastre-se como gestor para criar e publicar eventos.',
            'Configure lotes, imagens e localização no formulário de evento.',
            'Dúvidas comerciais: use o formulário de contato nesta página.',
        ],
    },
];

export const LANDING_FAQ_ITEMS: FaqItem[] = [
    {
        question: 'Como compro um ingresso?',
        answer: 'Abra o evento, selecione a quantidade desejada e clique em Comprar ingressos. Você será direcionado ao checkout seguro.',
    },
    {
        question: 'Onde vejo meus ingressos após a compra?',
        answer: 'Em Meus Ingressos, no menu da sua conta. Lá está o QR code para validação na entrada.',
    },
    {
        question: 'Posso cancelar ou pedir reembolso?',
        answer: 'Políticas de cancelamento dependem do organizador do evento. Entre em contato pelo formulário abaixo informando o evento e o pedido.',
    },
    {
        question: 'Como publico meu evento na EventFest?',
        answer: 'Crie uma conta de gestor, complete o cadastro da empresa e use Criar evento no painel. Após aprovação, o evento aparece na vitrine.',
    },
    {
        question: 'O que são créditos EventFest?',
        answer: 'Em eventos participantes, você pode pagar com saldo da carteira EventFest, conforme regras exibidas na página do evento.',
    },
];

export const PRE_LAUNCH_HERO = {
    badge: 'Lançamento em preparação',
    title: 'A plataforma premium para eventos ao vivo',
    subtitle:
        'Estamos finalizando a EventFest para conectar organizadores, empresas e público em uma experiência segura, moderna e memorável.',
};

export const PRE_LAUNCH_BENEFITS = [
    {
        title: 'Vitrine de eventos',
        body: 'Descubra shows, festivais e experiências com informações claras, filtros inteligentes e compra confiável.',
    },
    {
        title: 'Gestão completa',
        body: 'Organizadores cadastram eventos, definem lotes, acompanham vendas e relatórios em um painel profissional.',
    },
    {
        title: 'Pagamentos seguros',
        body: 'Checkout integrado às principais empresas de pagamento do mercado, com padrões de segurança e conformidade. Ingressos e créditos EventFest em um fluxo confiável — para você vender com tranquilidade e o público comprar com facilidade.',
    },
    {
        title: 'Experiência premium',
        body: 'Do ingresso digital à validação na entrada — tudo pensado para eventos de grande porte e médio porte.',
    },
];

export const PRE_LAUNCH_STATUS_MESSAGE =
    'Nossa equipe está em fase final de testes. Em breve você poderá explorar eventos e comprar ingressos por aqui. Enquanto isso, fale conosco se quiser saber mais ou ser avisado do lançamento.';

export const PRE_LAUNCH_MANAGER_INTRO = {
    title: 'Para quem organiza eventos',
    problem:
        'Produtoras e gestores ainda perdem tempo com planilhas, filas na entrada, dinheiro preso em caixa e pouca visão do que acontece dentro do evento. A EventFest nasce para centralizar gestão, controle e receita em um só lugar.',
    promise:
        'Do cadastro do evento à última venda no bar conveniado — com agilidade para o público e controle real para você.',
};

export const PRE_LAUNCH_MANAGER_PILLARS = [
    {
        title: 'Entrada sem fila',
        body: 'Ingresso digital com validação rápida na portaria. Menos gargalo, menos stress na abertura dos portões e mais previsibilidade sobre quem já entrou.',
    },
    {
        title: 'Créditos EventFest',
        body: 'O público recarrega saldo e consome com QR Code nos pontos do evento — sem enfrentar filas de caixa. Mais fluidez para o visitante e mais giro para a sua operação.',
    },
    {
        title: 'Empresas conveniadas',
        body: 'Integre bares, food trucks e lojas parceiras ao ecossistema do evento. Novas vendas no local, dados de consumo e uma experiência que fideliza quem volta no próximo show.',
    },
    {
        title: 'Gestão e controle',
        body: 'Painel para lotes, vendas, relatórios e acompanhamento em tempo real. Você enxerga o evento enquanto ele acontece — não só no dia seguinte.',
    },
];

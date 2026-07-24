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
        title: '1. Identificação e objeto',
        paragraphs: [
            'Estes Termos de Uso regulam o acesso e a utilização da plataforma EventFest (site, painéis e aplicativos associados), destinada à divulgação de eventos, venda ou distribuição de ingressos, gestão operacional por organizadores e serviços correlatos (incluindo, quando disponíveis, créditos/carteira digital e validação de entrada).',
            'A EventFest atua como intermediadora tecnológica entre o público (usuários consumidores) e os organizadores/gestores de eventos (pessoas físicas ou jurídicas). A realização do evento e o cumprimento das obrigações perante o consumidor, no que diz respeito ao espetáculo ou atividade em si, são de responsabilidade do respectivo organizador, ressalvadas as obrigações legais da plataforma.',
        ],
    },
    {
        title: '2. Aceitação',
        paragraphs: [
            'Ao acessar, cadastrar-se ou utilizar a EventFest, você declara que leu, compreendeu e concorda com estes Termos e com a Política de Privacidade disponível em /privacy.',
        ],
        bullets: [
            'Possui capacidade civil para contratar, ou está representado na forma da lei;',
            'Fornecerá informações verdadeiras e atualizadas;',
            'Não utilizará a plataforma para fins ilícitos ou abusivos.',
        ],
        paragraphsAfter: [
            'Se não concordar com qualquer condição, não utilize a plataforma.',
        ],
    },
    {
        title: '3. Conta e segurança',
        paragraphs: [
            'Determinadas funcionalidades exigem cadastro e autenticação. Você é responsável por manter a confidencialidade de senhas, dispositivos e códigos de acesso, e por todas as atividades realizadas sob sua conta.',
        ],
        listIntro: 'Você se compromete a:',
        bullets: [
            'Não compartilhar a conta com terceiros;',
            'Comunicar imediatamente uso indevido ou suspeita de acesso não autorizado;',
            'Manter dados cadastrais e de contato atualizados.',
        ],
        paragraphsAfter: [
            'A EventFest poderá recusar, suspender ou encerrar contas com indícios de fraude, violação destes Termos, risco à segurança ou ordem de autoridade competente.',
        ],
    },
    {
        title: '4. Regras de uso',
        listIntro: 'É vedado, entre outras condutas:',
        bullets: [
            'Praticar atos ilícitos ou que violem direitos de terceiros;',
            'Publicar conteúdo falso, ofensivo, discriminatório ou que induza a erro;',
            'Violar propriedade intelectual, marcas ou direitos autorais;',
            'Tentar invadir, explorar falhas, sobrecarregar ou comprometer a segurança dos sistemas;',
            'Utilizar bots, scraping abusivo, spam, phishing ou engenharia social;',
            'Revender, ceder ou comercializar acessos, ingressos ou créditos em desacordo com as regras do evento ou da plataforma.',
        ],
        paragraphsAfter: [
            'O descumprimento pode resultar em suspensão, remoção de conteúdo, cancelamento de ingressos/créditos quando cabível, e medidas legais.',
        ],
    },
    {
        title: '5. Eventos e papel dos organizadores',
        paragraphs: [
            'Os organizadores são responsáveis pelas informações do evento (data, local, classificação etária, regras de entrada, política de troca/cancelamento do evento), pela realização do evento e pelo atendimento ao público no que se refere à experiência contratada.',
        ],
        listIntro: 'A EventFest, na qualidade de plataforma, em regra não se responsabiliza por:',
        bullets: [
            'Cancelamento, adiamento ou alteração do evento pelo organizador;',
            'Falhas de operação no local (fila, segurança do venue, qualidade artística etc.);',
            'Condutas de organizadores, participantes ou terceiros;',
            'Promessas comerciais feitas pelo organizador fora da plataforma.',
        ],
        paragraphsAfter: [
            'Reclamações sobre o evento devem ser direcionadas prioritariamente ao organizador, sem prejuízo dos direitos do consumidor perante a plataforma quando a lei assim exigir.',
        ],
    },
    {
        title: '6. Ingressos, pagamentos, créditos e reembolsos',
        paragraphs: [
            'A compra de ingressos e demais cobranças podem ser processadas por meios de pagamento de terceiros (como Mercado Pago) e/ou, quando disponível, por saldo de créditos EventFest. A EventFest não armazena dados completos de cartão de crédito/débito.',
        ],
        listIntro: 'Valores, taxas, comissões e prazos podem variar conforme:',
        bullets: [
            'O tipo de plano do organizador e as regras comerciais da plataforma;',
            'As condições do meio de pagamento;',
            'A política específica do evento informada na compra.',
        ],
        listIntro2: 'Sobre reembolsos, chargebacks e cancelamentos:',
        bullets2: [
            'Pedidos de reembolso seguem a política do organizador, as regras informadas no checkout e a legislação aplicável (incluindo CDC, quando cabível);',
            'Contestações/chargebacks junto à operadora podem resultar em cancelamento do ingresso e cobranças previstas em contrato/aditivos com o organizador;',
            'Créditos EventFest seguem regras próprias de uso, validade e eventual estorno divulgadas no produto.',
        ],
    },
    {
        title: '7. Validação de entrada e uso do ingresso',
        paragraphs: [
            'O ingresso (QR, código ou meio equivalente) é pessoal conforme as regras do evento. A validação na portaria pode ser feita por ferramentas da EventFest sob chave/autorização do organizador.',
            'O uso indevido do ingresso, tentativa de fraude ou duplicidade pode implicar recusa de entrada e medidas cabíveis, sem prejuízo de outras sanções.',
        ],
    },
    {
        title: '8. Propriedade intelectual',
        paragraphs: [
            'Marcas, logotipos, layout, textos, software, bases de dados e demais elementos da EventFest são protegidos por direitos de propriedade intelectual.',
            'É proibida a reprodução, engenharia reversa ou exploração comercial sem autorização prévia, ressalvado o uso legítimo necessário para utilizar a plataforma.',
            'Conteúdos enviados por organizadores (imagens, textos, músicas etc.) permanecem sob responsabilidade de quem os publica, que declara ter direitos para tanto.',
        ],
    },
    {
        title: '9. Privacidade',
        paragraphs: [
            'O tratamento de dados pessoais observa a Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018) e a Política de Privacidade da EventFest, disponível em /privacy, que integra estes Termos.',
        ],
    },
    {
        title: '10. Disponibilidade e alterações do serviço',
        paragraphs: [
            'Empregamos esforços razoáveis para manter a plataforma disponível, sem garantia de funcionamento ininterrupto ou livre de erros. Podem ocorrer manutenções, atualizações, instabilidades ou indisponibilidades temporárias.',
            'A EventFest pode modificar funcionalidades, limites e condições comerciais, comunicando mudanças relevantes quando exigido.',
        ],
    },
    {
        title: '11. Limitação de responsabilidade',
        paragraphs: [
            'Na máxima extensão permitida pela lei brasileira, a EventFest não responde por danos indiretos, lucros cessantes, perda de chance ou prejuízos decorrentes de fato de terceiro, falha de conectividade do usuário, ou decisões do organizador sobre o evento.',
            'Nada nestes Termos exclui responsabilidades que não possam ser afastadas por lei, em especial normas de ordem pública de proteção ao consumidor, quando aplicáveis.',
        ],
    },
    {
        title: '12. Suspensão e encerramento',
        paragraphs: [
            'Você pode solicitar o encerramento da conta pelos canais oficiais. A EventFest pode suspender ou encerrar o acesso em caso de violação destes Termos, risco à segurança, fraude ou determinação legal.',
            'O encerramento não elimina obrigações já constituídas (pagamentos, débitos, registros necessários por lei ou disputa).',
        ],
    },
    {
        title: '13. Alterações destes Termos',
        paragraphs: [
            'Podemos atualizar estes Termos periodicamente. A versão vigente será publicada em /terms, com data de atualização. O uso contínuo após a publicação, quando admitido pela lei, implica ciência das alterações; em casos que exijam novo consentimento ou destaque, adotaremos a formalidade cabível.',
        ],
    },
    {
        title: '14. Lei aplicável e foro',
        paragraphs: [
            'Estes Termos são regidos pelas leis da República Federativa do Brasil.',
            'Fica eleito o foro da comarca da sede da EventFest, com renúncia a qualquer outro, por mais privilegiado que seja, salvo foro do consumidor quando obrigatório por lei.',
        ],
    },
    {
        title: '15. Contato',
        paragraphs: [
            'Dúvidas sobre estes Termos: utilize o formulário de contato do site (eventfest.com.br) ou os canais oficiais indicados no rodapé.',
            'Última atualização: julho de 2026.',
        ],
    },
];

/** Política de Privacidade completa (LGPD) — páginas /privacy. */
export const LANDING_PRIVACY_SECTIONS: LandingTermsSection[] = [
    {
        title: '1. Introdução e controlador',
        paragraphs: [
            'Esta Política de Privacidade descreve como a EventFest (“nós”, “plataforma”) trata dados pessoais no âmbito do site eventfest.com.br, painéis web, aplicativos e serviços correlatos.',
            'Para fins da Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018), a EventFest atua, em regra, como controladora dos dados necessários à operação da plataforma (conta, autenticação, suporte, segurança e intermediação tecnológica). Quando o organizador define finalidades próprias sobre o público do seu evento (por exemplo, listas de convidados ou comunicações do evento), ele pode atuar como controlador independente ou controlador conjunto, conforme o caso.',
            'Esta Política não dispensa a leitura dos Termos de Uso (/terms).',
        ],
    },
    {
        title: '2. Quais dados coletamos',
        listIntro: 'Dependendo do uso da plataforma, podemos tratar:',
        bullets: [
            'Dados de identificação e contato: nome, e-mail, telefone, documento (CPF/CNPJ quando necessário), data de nascimento e demais dados de perfil;',
            'Dados de conta e autenticação: credenciais, histórico de login e registros de segurança;',
            'Dados de transação: pedidos, ingressos, status de pagamento, identificadores de cobrança junto a processadores (ex.: Mercado Pago), créditos/carteira e movimentações relacionadas;',
            'Dados de evento e operação: eventos favoritos ou inscritos, check-in/validação de entrada, avaliações/feedback quando fornecidos;',
            'Dados de organizadores/empresas: razão social, dados cadastrais, dados de faturamento, configurações de plano e documentos exigidos para habilitação;',
            'Dados técnicos: endereço IP, identificadores de dispositivo, logs, tipo de navegador, páginas acessadas e cookies/tecnologias similares;',
            'Conteúdo enviado voluntariamente: mensagens de contato, feedback e anexos eventualmente necessários ao suporte.',
        ],
        paragraphsAfter: [
            'Não solicitamos nem armazenamos o número completo do cartão de pagamento. Dados sensíveis de pagamento são tratados pelos provedores de pagamento sob suas próprias políticas.',
        ],
    },
    {
        title: '3. Para que usamos os dados (finalidades)',
        listIntro: 'Tratamos dados pessoais para:',
        bullets: [
            'Criar e gerenciar contas, autenticar usuários e prevenir fraude;',
            'Viabilizar compra, emissão, exibição e validação de ingressos;',
            'Processar pagamentos, créditos, repasses e conciliações com organizadores;',
            'Prestar suporte, responder contatos e comunicar status de pedidos/eventos;',
            'Cumprir obrigações legais, regulatórias e ordens de autoridades;',
            'Melhorar segurança, desempenho e experiência da plataforma (incluindo análises agregadas);',
            'Enviar comunicações operacionais essenciais (ex.: confirmação de compra, alertas de segurança).',
        ],
        paragraphsAfter: [
            'Comunicações de marketing só serão enviadas quando houver base legal adequada (por exemplo, consentimento) ou hipótese legal aplicável, com opção de opt-out quando exigido.',
        ],
    },
    {
        title: '4. Bases legais (LGPD)',
        listIntro: 'Conforme o contexto, utilizamos uma ou mais das seguintes bases (art. 7º e correlatos da LGPD):',
        bullets: [
            'Execução de contrato ou procedimentos preliminares (cadastro, compra, prestação do serviço);',
            'Cumprimento de obrigação legal ou regulatória;',
            'Legítimo interesse, com avaliação de impacto e respeito aos direitos do titular (ex.: segurança, prevenção a fraude, melhoria do serviço), quando aplicável;',
            'Consentimento, quando exigido (ex.: determinadas comunicações ou cookies não essenciais);',
            'Exercício regular de direitos em processo judicial, administrativo ou arbitral.',
        ],
    },
    {
        title: '5. Compartilhamento com terceiros',
        paragraphs: [
            'Não vendemos dados pessoais. Podemos compartilhar dados com:',
        ],
        bullets: [
            'Organizadores do evento, na medida necessária à emissão do ingresso, lista de participantes, validação de entrada e atendimento do evento;',
            'Processadores de pagamento e instituições financeiras parceiras;',
            'Prestadores de infraestrutura (hospedagem, e-mail, monitoramento, analytics) sob obrigação de confidencialidade e conforme contratos de tratamento;',
            'Autoridades públicas, quando houver obrigação legal ou ordem válida;',
            'Sucessores em eventual reorganização societária, com continuidade das salvaguardas.',
        ],
        paragraphsAfter: [
            'Exigimos de operadores contratuais medidas compatíveis com a LGPD e limitamos o compartilhamento ao mínimo necessário.',
        ],
    },
    {
        title: '6. Cookies e tecnologias similares',
        paragraphs: [
            'Utilizamos cookies e tecnologias semelhantes para autenticação de sessão, preferências, segurança e, quando habilitado, medição de audiência.',
            'Você pode gerenciar cookies pelo navegador. A desativação de cookies essenciais pode impedir o funcionamento adequado do login e da compra.',
        ],
    },
    {
        title: '7. Armazenamento, retenção e segurança',
        paragraphs: [
            'Os dados são armazenados em ambientes com controles de acesso, criptografia em trânsito (HTTPS) e demais medidas técnicas e administrativas razoáveis.',
            'Mantemos os dados pelo tempo necessário às finalidades desta Política, incluindo prazos legais de guarda (fiscal, consumerista, combate a fraude) e resolução de disputas. Após o prazo, dados podem ser eliminados, anonimizados ou bloqueados, conforme a lei.',
            'Nenhum sistema é 100% seguro. Em caso de incidente relevante de segurança que possa causar risco ou dano relevante aos titulares, adotaremos as providências cabíveis, inclusive comunicação à ANPD e aos titulares quando exigido.',
        ],
    },
    {
        title: '8. Transferências internacionais',
        paragraphs: [
            'Alguns provedores de nuvem ou ferramentas podem processar dados fora do Brasil. Nesses casos, buscamos mecanismos compatíveis com a LGPD (cláusulas contratuais, políticas do fornecedor e demais salvaguardas adequados).',
        ],
    },
    {
        title: '9. Direitos do titular',
        paragraphs: [
            'Nos termos da LGPD, você pode solicitar, na medida aplicável:',
        ],
        bullets: [
            'Confirmação da existência de tratamento e acesso aos dados;',
            'Correção de dados incompletos, inexatos ou desatualizados;',
            'Anonimização, bloqueio ou eliminação de dados desnecessários ou excessivos;',
            'Portabilidade, quando aplicável e viável tecnicamente;',
            'Informação sobre compartilhamentos;',
            'Revogação de consentimento, quando o tratamento se basear nele;',
            'Oposição a tratamento realizado com base em legítimo interesse, observados os limites legais;',
            'Revisão de decisões automatizadas, quando cabível.',
        ],
        paragraphsAfter: [
            'Para exercer direitos, use o formulário de contato do site ou os canais oficiais do rodapé, identificando-se de forma segura. Poderemos solicitar informações adicionais para confirmar a identidade e responder no prazo legal.',
            'Se entender que o tratamento não está adequado, também é possível apresentar reclamação à Autoridade Nacional de Proteção de Dados (ANPD).',
        ],
    },
    {
        title: '10. Crianças e adolescentes',
        paragraphs: [
            'A plataforma não é direcionada a menores de 16 anos sem a devida representação/assistência. Cadastros e compras que envolvam menores devem observar a legislação civil e consumerista aplicável. Organizadores são responsáveis por regras de classificação etária do evento.',
        ],
    },
    {
        title: '11. Alterações desta Política',
        paragraphs: [
            'Podemos atualizar esta Política para refletir mudanças legais ou do serviço. A versão vigente será publicada em /privacy, com indicação da data de atualização. Quando a alteração for relevante, poderemos destacar o aviso na plataforma ou solicitar novo aceite, conforme o caso.',
        ],
    },
    {
        title: '12. Contato',
        paragraphs: [
            'Para questões de privacidade e proteção de dados: formulário de contato em eventfest.com.br ou canais oficiais indicados no rodapé.',
            'Última atualização: julho de 2026.',
        ],
    },
];

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

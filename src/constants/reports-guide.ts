/**
 * Guia explicativo da Central de Relatórios (gestor e Admin Master).
 * Usado pelo Dialog e pelos links "?" de cada card.
 */

export type ReportsGuideAudience = 'gestor' | 'admin' | 'both';

export type ReportsGuideEntry = {
    id: string;
    audience: ReportsGuideAudience;
    title: string;
    /** Uma linha para o card / sumário */
    summary: string;
    /** Para que serve */
    purpose: string;
    /** Como usar / o que mostra */
    howItWorks: string[];
    /** Dicas práticas */
    tips?: string[];
    /** O que deve bater com outro relatório */
    matchesWith?: string;
};

export const REPORTS_GUIDE_INTRO = {
    title: 'Guia dos relatórios',
    subtitle:
        'Use este guia para saber a finalidade de cada relatório, o que cada número significa e quais telas devem mostrar os mesmos valores (gestor × Admin Master).',
    matchBoxTitle: 'O que deve bater (sem dúvida)',
    matchBoxItems: [
        'A receber / a transferir (ingresso modo banco D+1 + consumo/crédito): gestor em “Repasses D+1” ↔ Admin em Créditos → aba Repasses (mesmo ledger).',
        'Comissão de ingresso EventFest: Relatório Financeiro (coluna Comissão Sistema) — no gestor e no Admin, com o mesmo filtro de período/evento.',
        'Comissão de consumo/crédito: gestor em “Consumos via crédito” ↔ Admin em Créditos → aba Comissões.',
        'Ingresso com Mercado Pago (split): o líquido já caiu na conta MP do gestor. Não entra na fila de TED/PIX dos Repasses — confira no Relatório Financeiro (“Recebido gestor” / Split Registrado).',
    ],
};

export const REPORTS_GUIDE_ENTRIES: ReportsGuideEntry[] = [
    {
        id: 'financial',
        audience: 'both',
        title: 'Relatório Financeiro',
        summary:
            '★ Relatório principal de ingressos: bruto, % EventFest, % MP e líquido (lucro) do gestor.',
        purpose:
            'É o relatório principal de vendas de ingresso. Serve para conferir quanto foi vendido, quanto a EventFest reteve de comissão, quanto o Mercado Pago cobrou de taxa e quanto ficou (ou ficará) para o gestor — por evento e por transação.',
        howItWorks: [
            'Lista transações de pagamento (pendentes, pagas e falhas) com valor bruto, %/R$ MP, %/R$ comissão do sistema e “Recebido gestor”.',
            'Modo Mercado Pago (conta MP conectada): o líquido do gestor cai na conta dele no ato (split). A coluna Split mostra Registrado; a comissão EventFest vai via marketplace fee.',
            'Modo conta bancária (D+1): a EventFest cobra na própria conta MP; o líquido do gestor entra na fila de Repasses D+1 para TED/PIX depois da retenção.',
            'Pagamento com crédito EventFest: não há split no MP; comissão e líquido seguem o fluxo de crédito/repasses.',
            'Há totais por evento (valores vendidos, comissão e líquido) e filtros de status/período conforme a tela.',
        ],
        tips: [
            'Admin Master vê a rede (conforme filtro) e a soma de comissão EventFest do período.',
            'Gestor: use este relatório para comissão de ingresso; use “Repasses D+1” para o que ainda falta receber em dinheiro (modo banco e crédito).',
        ],
        matchesWith:
            'Líquido de ingresso no modo banco deve bater com os lançamentos de origem “ingresso” em Repasses D+1. Comissão de ingresso bate com a soma Admin no mesmo filtro.',
    },
    {
        id: 'sales',
        audience: 'both',
        title: 'Relatório de Vendas',
        summary: 'Performance comercial: receita, volume de ingressos e comparação entre eventos.',
        purpose:
            'Análise de desempenho de vendas (quantidade e receita), útil para acompanhar evolução e comparar eventos — não substitui o Relatório Financeiro para comissão/split.',
        howItWorks: [
            'Mostra indicadores de receita e ingressos vendidos.',
            'Ajuda a identificar eventos com melhor performance e períodos mais fortes.',
            'Complementa o gráfico rápido da Central de Relatórios.',
        ],
        tips: [
            'Para “quanto me devem / quanto a EventFest me deve” use Repasses e Financeiro, não só este relatório.',
        ],
    },
    {
        id: 'events',
        audience: 'both',
        title: 'Relatório de Eventos',
        summary: 'Cadastro e situação dos eventos: ativos, passados, ocupação e dados operacionais.',
        purpose:
            'Visão cadastral e operacional dos eventos da empresa (ou da rede, no Admin): status, datas, capacidade/ocupação e informações básicas de gestão.',
        howItWorks: [
            'Lista eventos ativos e históricos.',
            'Ajuda a auditar se o evento está aberto a vendas, lotação e dados de publicação.',
        ],
    },
    {
        id: 'audience',
        audience: 'both',
        title: 'Relatório de Público',
        summary: 'Perfil e comportamento dos compradores de ingresso.',
        purpose:
            'Entender o público que comprou: demografia e padrões de compra, para marketing e planejamento do próximo evento.',
        howItWorks: [
            'Consolida dados dos clientes vinculados às compras de ingresso.',
            'Não é relatório financeiro de repasse ou comissão.',
        ],
    },
    {
        id: 'registrations',
        audience: 'both',
        title: 'Relatório de Inscrições',
        summary: 'Lista de inscritos por evento, com apoio a confirmação/impressão e presença.',
        purpose:
            'Controle operacional de quem se inscreveu ou comprou: listagens para portaria, impressão e acompanhamento de confirmação.',
        howItWorks: [
            'Filtra por evento e exibe inscritos/compradores.',
            'Útil para equipes de credenciamento e check-in.',
        ],
    },
    {
        id: 'wristband-movements',
        audience: 'both',
        title: 'Movimentação de Ingressos',
        summary: 'Passagens na portaria: entradas/saídas por ingresso e totais do evento.',
        purpose:
            'Auditar o uso do ingresso no evento (validações na portaria), não o valor financeiro da venda.',
        howItWorks: [
            'Mostra movimentações (entrada/saída) vinculadas aos ingressos.',
            'Ajuda a detectar uso indevido ou volume real de público presente.',
        ],
    },
    {
        id: 'listing-monthly',
        audience: 'gestor',
        title: 'Mensalidade de divulgação',
        summary: 'Faturas do plano vitrine (divulgação sem venda de ingresso pela plataforma).',
        purpose:
            'Acompanhar e pagar a mensalidade de divulgação quando a empresa está no plano vitrine (listagem), sem vender ingresso via EventFest.',
        howItWorks: [
            'Lista faturas/períodos da mensalidade de vitrine.',
            'Não mistura com repasse de venda de ingresso nem com consumo de crédito.',
        ],
    },
    {
        id: 'credit-spends',
        audience: 'gestor',
        title: 'Consumos via crédito',
        summary:
            '★ Relatório principal de consumo: bruto, comissão EventFest e líquido do gestor (PDV + carteira).',
        purpose:
            'Ver o que a sua empresa recebeu via crédito do cliente: ingressos pagos com saldo EventFest e consumos no PDV/parceiros — com destaque para a comissão EventFest e o líquido da empresa.',
        howItWorks: [
            'Totais: valor bruto (gross), comissão EventFest e líquido da empresa.',
            'Lista movimentações com data, descrição/evento, gross e líquido.',
            'O valor líquido entra na fila de Repasses D+1 para pagamento (TED/PIX) após a retenção.',
        ],
        tips: [
            'Use este relatório para entender comissão de consumo/crédito.',
            'Para “quando vou receber o dinheiro”, abra Repasses D+1 (retenção / aguardando pagamento / pagos).',
        ],
        matchesWith:
            'Comissão e líquidos devem alinhar com os lançamentos de crédito em Repasses e, no Admin, com a aba Comissões / Contábil no mesmo recorte.',
    },
    {
        id: 'credit-product-inventory',
        audience: 'gestor',
        title: 'Estoque e vendas de produtos',
        summary:
            'Catálogo de consumo: quantidade em estoque e quantidade já vendida (crédito EventFest), em colunas separadas.',
        purpose:
            'Acompanhar o saldo físico/cadastral dos produtos do estabelecimento frente ao que já foi vendido no PDV e no cardápio do cliente.',
        howItWorks: [
            'Lista cada produto do catálogo com estabelecimento, preço e embalagem.',
            'Coluna Em estoque: quantity atual do cadastro.',
            'Coluna Vendidos: soma das vendas concluídas em credit_spend_line_items (PDV + app).',
            'Receita vendida: soma dos line_total das mesmas vendas.',
            'Filtro opcional por estabelecimento.',
        ],
        tips: [
            'Itens vendidos no PDV sem product_id (digitados à mão) não entram nesta grade — só o catálogo cadastrado.',
            'Estoque 0 e vendas > 0 é esperado após esgotar o produto.',
        ],
        matchesWith:
            'Vendidos devem acompanhar os consumos do relatório Consumos via crédito no mesmo período operacional.',
    },
    {
        id: 'credit-settlements',
        audience: 'gestor',
        title: 'Repasses D+1 — Crédito e ingressos (banco)',
        summary:
            'Extrato do que a EventFest deve pagar ao gestor: retenção, liberado e já pago (crédito + ingresso modo banco).',
        purpose:
            'É o relatório “a receber” do gestor no fluxo manual D+1. Reúne líquido de vendas de ingresso no modo conta bancária e de consumos/crédito, após a comissão EventFest.',
        howItWorks: [
            'Cards: Em retenção D+1 · Aguardando pagamento · Já recebidos · Clawback (se houver).',
            'Extrato unificado: origem ingresso (D+1) ou crédito/consumo, com status e valores líquidos.',
            'Após a retenção (ex.: D+1), o item fica liberado para a EventFest registrar o pagamento (PIX/TED) no painel Admin.',
            'Pode exibir débitos de chargeback de ingresso a descontar nos próximos repasses (planos com crédito).',
        ],
        tips: [
            'Ingresso com split MP não aparece aqui como “a transferir” — o dinheiro já foi para a conta MP.',
            'Confira o mesmo valor no Admin: Créditos → Repasses, filtrando sua empresa.',
        ],
        matchesWith:
            'Deve ser idêntico (por empresa e status) ao que o Admin Master vê em Créditos → aba Repasses.',
    },
    {
        id: 'credit-accounting',
        audience: 'gestor',
        title: 'Relatório contábil (créditos)',
        summary:
            '★ Relatório principal do caixa de crédito: recargas, consumos e repasses (CSV).',
        purpose:
            'Exportar e arquivar movimentos de crédito para contabilidade ou conciliação interna — complementar aos Repasses e Consumos.',
        howItWorks: [
            'Consolida recargas originadas na empresa, consumos recebidos e repasses.',
            'Permite exportação CSV para o contador.',
        ],
        tips: [
            'Não é a tela operacional de “pagar agora”; para isso use Repasses D+1.',
        ],
    },
    {
        id: 'ticket-chargebacks',
        audience: 'gestor',
        title: 'Chargebacks de ingresso',
        summary:
            'Dívidas por chargeback/estorno MP: PIX/TED (plano só ingresso) ou desconto no repasse D+1 (plano com crédito).',
        purpose:
            'Acompanhar quando o Mercado Pago avisa chargeback de uma venda de ingresso e o que a empresa deve devolver ou terá descontado.',
        howItWorks: [
            'Lista dívidas abertas/parciais/quitadas com valores e modo de recuperação.',
            'Plano só ingresso: devolução manual via PIX/TED com referência EF-TCB-{id}.',
            'Plano com crédito/híbrido: abatimento automático nos próximos repasses D+1.',
            'Três dívidas em aberto com saldo podem bloquear cadastro/reativação de eventos.',
        ],
        tips: [
            'Mantenha o comprovante e a referência do pagamento; o Admin Master registra a baixa.',
        ],
    },
    {
        id: 'consumption-license',
        audience: 'gestor',
        title: 'Licença mensal de consumo',
        summary: 'Faturas da licença do plano consumo/licença — pagamento libera o módulo de créditos.',
        purpose:
            'Controlar a licença mensal exigida em planos de consumo: sem pagamento em dia, o módulo de créditos/PDV pode ficar bloqueado.',
        howItWorks: [
            'Lista faturas e status de pagamento da licença.',
            'Independe do Relatório Financeiro de ingressos.',
        ],
    },
    {
        id: 'complimentary-bundles',
        audience: 'gestor',
        title: 'Pacotes cortesia',
        summary: 'Pacotes Staff enviados, resgates e destinatários.',
        purpose:
            'Auditar cortesias/staff: o que foi enviado, quem resgatou e em qual ingresso — uso operacional, sem valor de venda.',
        howItWorks: [
            'Lista pacotes, resgates e destinatários.',
            'Exclusivo do gestor (não é tela Admin de receita).',
        ],
    },
    {
        id: 'feedback',
        audience: 'gestor',
        title: 'Feedback dos clientes',
        summary: 'Notas, temas e opiniões dos clientes sobre seus eventos.',
        purpose:
            'Acompanhar satisfação e comentários pós-evento para melhorar a operação e a comunicação.',
        howItWorks: [
            'Agrega avaliações e temas enviados pelos clientes.',
            'Não impacta comissão nem repasse.',
        ],
    },
    {
        id: 'admin-revenue',
        audience: 'admin',
        title: 'Receita da plataforma',
        summary:
            '★ Relatório principal Admin: receita EventFest (vitrine, licença, inatividade e comissões).',
        purpose:
            'Visão gerencial do que a EventFest faturou como plataforma (recorrente + comissões), separada do que deve ser transferido aos gestores.',
        howItWorks: [
            'Abre o painel de créditos Admin na aba Receita plataforma.',
            'Soma receitas recorrentes e comissões no período filtrado.',
            'Não substitui a aba Repasses (fila de TED/PIX aos gestores).',
        ],
        tips: [
            'Para “quanto pagar ao gestor X”, use aba Repasses; para “quanto a EventFest ganhou”, use esta receita.',
        ],
    },
    {
        id: 'admin-settlements',
        audience: 'admin',
        title: 'Repasses de crédito (rede)',
        summary:
            'Fila operacional Admin: retenção D+1, liberados a pagar e histórico — ingressos modo banco + consumo/crédito de todas as empresas.',
        purpose:
            'É o relatório “a transferir” do Admin Master. Mostra, por empresa, o que está em retenção, o que já pode ser pago (PIX/TED) e o que já foi liquidado — alinhado ao extrato que o gestor vê.',
        howItWorks: [
            'Filtros: Retenção D+1 · Liberados / a pagar · Histórico.',
            'Permite registrar pagamento com referência e comprovante.',
            'Inclui lançamentos de ingresso D+1 (bank_transfer) e de crédito/consumo.',
            'Exportação CSV disponível para conferência.',
        ],
        tips: [
            'Antes de pagar, confira se a empresa está em modo banco ou se o lançamento é de crédito.',
            'Valores por empresa devem bater com o Repasses D+1 do gestor daquela empresa.',
        ],
        matchesWith:
            'Mesmo ledger do gestor em /manager/credit/settlements (por company_id e status).',
    },
    {
        id: 'admin-accounting',
        audience: 'admin',
        title: 'Relatório contábil (créditos) — rede',
        summary: 'Toda a rede EventFest: recargas, consumos e estornos — CSV para contador.',
        purpose:
            'Fechamento contábil da carteira de créditos em toda a plataforma, para auditoria e envio ao contador.',
        howItWorks: [
            'Abre a aba Contábil do painel Admin de créditos.',
            'Cobre recargas, consumos e estornos em escala de rede.',
        ],
    },
    {
        id: 'admin-credit-panel',
        audience: 'admin',
        title: 'Painel créditos Admin',
        summary:
            '★ Hub principal Admin: comissão de consumo, receita, posição financeira, totais MP e chargebacks.',
        purpose:
            'Central completa do módulo de créditos para o Admin Master. Cada aba tem um papel: do passivo (saldo nas carteiras) até a conciliação com o Mercado Pago.',
        howItWorks: [
            'Passivo: saldos nas carteiras dos clientes (obrigação EventFest).',
            'Comissões: comissão EventFest sobre consumo/crédito.',
            'Cross-empresa: fluxos entre empresas/parceiros.',
            'Auditoria: trilha de eventos sensíveis.',
            'Repasses: fila a transferir (ver item específico).',
            'Estornos: débito administrativo na carteira + clawback.',
            'Contábil / Posição financeira / Receita / Conciliação MP / Chargebacks: fechamento e risco.',
        ],
        tips: [
            'Comece por Repasses no dia a dia operacional; use Comissões e Receita para gestão; Conciliação MP e Chargebacks para risco.',
        ],
    },
    {
        id: 'admin-contract-acceptances',
        audience: 'admin',
        title: 'Aceites de contrato',
        summary: 'Auditoria de aceites: versão, hash, snapshot, usuário e data/hora.',
        purpose:
            'Prova de que a empresa aceitou o contrato/aditivo vigente (versão e conteúdo), para compliance e suporte a disputas.',
        howItWorks: [
            'Lista aceites com metadados de versão e identidade do usuário.',
            'Não é relatório financeiro.',
        ],
    },
    {
        id: 'admin-ticket-inventory',
        audience: 'admin',
        title: 'Estoque de ingressos (Admin)',
        summary: 'Por empresa e evento: criado, vendido e ainda disponível.',
        purpose:
            'Visão Admin do inventário de ingressos em toda a rede — útil para suporte e auditoria de disponibilidade.',
        howItWorks: [
            'Agrega estoque por empresa/evento.',
            'Não mostra comissão nem fila de repasse.',
        ],
    },
];

export function getReportsGuideEntry(id: string): ReportsGuideEntry | undefined {
    return REPORTS_GUIDE_ENTRIES.find((e) => e.id === id);
}

/** Admin vê tudo (rede + gestor); gestor não vê entradas exclusivas Admin. */
export function filterReportsGuideForUser(isAdminMaster: boolean): ReportsGuideEntry[] {
    if (isAdminMaster) {
        return REPORTS_GUIDE_ENTRIES;
    }
    return REPORTS_GUIDE_ENTRIES.filter((e) => e.audience !== 'admin');
}

/**
 * Guias de ajuda das telas operacionais do gestor
 * (cadastro/edição de evento, ingressos e chaves de validação).
 */

export type ManagerScreenGuideId =
    | 'event-create'
    | 'event-edit'
    | 'wristband-create'
    | 'validation-keys';

export type ManagerScreenGuideSection = {
    title: string;
    items: string[];
};

export type ManagerScreenGuide = {
    id: ManagerScreenGuideId;
    title: string;
    subtitle: string;
    purpose: string;
    requiredFields: Array<{ field: string; detail: string }>;
    steps: string[];
    tips?: string[];
    sections?: ManagerScreenGuideSection[];
};

export const MANAGER_SCREEN_GUIDES: Record<ManagerScreenGuideId, ManagerScreenGuide> = {
    'event-create': {
        id: 'event-create',
        title: 'Ajuda: cadastrar evento',
        subtitle: 'Passo a passo para publicar um evento completo e sem erros.',
        purpose:
            'Esta tela cria o evento na EventFest (página pública, venda de ingresso e, se o plano permitir, consumo). Preencha tudo com atenção: depois da publicação, alguns dados impactam estoque, portaria e relatórios.',
        requiredFields: [
            {
                field: 'Título',
                detail: 'Nome do evento (mín. 3 caracteres). Aparece na vitrine e nos ingressos.',
            },
            {
                field: 'Data e hora',
                detail: 'Dia e horário de início. Definem validade e a expiração automática das chaves de validação.',
            },
            {
                field: 'Local e endereço',
                detail: 'Nome do local + endereço completo. Use o endereço correto para o mapa e a busca do cliente.',
            },
            {
                field: 'Imagens (card e exposição)',
                detail: 'URLs válidas das imagens principais do evento. Sem imagem o card fica incompleto na vitrine.',
            },
            {
                field: 'Categoria, capacidade, duração e idade mínima',
                detail: 'Capacidade = público máximo; duração ajuda a calcular o fim do evento; idade mínima (0–18).',
            },
            {
                field: 'Lotes (se evento pago)',
                detail:
                    'Pelo menos 1 lote de venda com nome, quantidade, preço (> 0) e período. Para Staff/convidados, marque “Lote cortesia / gratuito” (preço R$ 0,00 automático) — o nome do lote pode ser qualquer um.',
            },
            {
                field: 'Contrato do evento (quando existir)',
                detail: 'Se houver contrato ativo para o evento, leia até o final e aceite antes de salvar.',
            },
        ],
        steps: [
            'Confirme o plano e o recebimento (Mercado Pago ou conta/PIX) antes de criar evento com venda.',
            'Preencha detalhes → mídia → preço/lotes (se pago).',
            'Revise título, data, local e lotes. Salve o evento.',
            'Em seguida: gere ingressos (se necessário) e crie a chave de validação da portaria.',
        ],
        tips: [
            'Evento gratuito: não precisa de lotes pagos; ainda assim preencha capacidade e imagens.',
            'Evento pago: cadastre lotes com estoque real — isso alimenta a venda online e os relatórios.',
            'Cortesia: marque “Lote cortesia / gratuito” no lote, salve, depois use “Enviar pacotes cortesia”.',
            'Depois de salvar, use “Chaves de validação” para liberar a portaria no dia.',
        ],
    },
    'event-edit': {
        id: 'event-edit',
        title: 'Ajuda: editar evento',
        subtitle: 'O que pode alterar e o que observar após o evento já existir.',
        purpose:
            'Atualize dados do evento já cadastrado. Alterações em data, capacidade e lotes afetam vendas, estoque e chaves de validação — confira o checklist de publicação quando disponível.',
        requiredFields: [
            {
                field: 'Campos obrigatórios',
                detail:
                    'Os mesmos do cadastro: título, data, hora, local, endereço, imagens, categoria, capacidade, duração e idade mínima.',
            },
            {
                field: 'Lotes (evento pago)',
                detail:
                    'Mantenha pelo menos um lote válido. Em alguns modos de estoque, a quantidade só pode aumentar — o sistema avisa se a redução não for permitida.',
            },
        ],
        steps: [
            'Revise o checklist de “ir ao ar” (se aparecer no topo).',
            'Ajuste o que for necessário e salve.',
            'Se mudou data/hora do evento, confira se as chaves de validação ainda expiram no horário correto.',
            'Se alterou lotes/preço, confira o estoque em Ingressos / painel de inventário.',
        ],
        tips: [
            'Evento encerrado (ciclo finalizado) pode bloquear edições sensíveis.',
            'Não apague lotes com vendas já realizadas — ajuste com cuidado.',
        ],
    },
    'wristband-create': {
        id: 'wristband-create',
        title: 'Ajuda: cadastrar ingresso',
        subtitle: 'Como gerar ingressos/pulseiras vinculados a um evento.',
        purpose:
            'Gera o ingresso (código) e os registros de uso associados ao evento. Use para emissão manual/física ou preparação da portaria. Vendas online já criam o QR na compra. Cortesia/staff: use Pacotes cortesia do evento (lote R$ 0), não esta tela com valor zerado.',
        requiredFields: [
            {
                field: 'Evento associado',
                detail: 'Obrigatório. Escolha o evento correto; o ingresso fica ligado só a ele.',
            },
            {
                field: 'Código base',
                detail:
                    'Código único do ingresso (ex.: CONCERTO-VIP-A1). Em eventos com estoque por contador (lotes online), este campo pode ficar desabilitado.',
            },
            {
                field: 'Quantidade',
                detail:
                    'Quantos registros gerar a partir deste cadastro. Respeite o limite do formulário e o mínimo de ingressos do plano, se aplicável.',
            },
            {
                field: 'Tipo de acesso',
                detail: 'Standard, VIP, Staff etc. Ajuda a organizar a operação (não substitui o lote de venda).',
            },
            {
                field: 'Valor',
                detail:
                    'Preço do ingresso neste cadastro (formato brasileiro, ex.: 50,00). Em planos com venda, o valor pode ser obrigatório conforme a regra do evento.',
            },
        ],
        steps: [
            'Selecione o evento (e confira o painel de estoque dos lotes, se aparecer).',
            'Informe código, quantidade, tipo e valor.',
            'Clique em “Gerar e Gravar Ingresso”.',
            'Guarde/imprima o código ou use o fluxo de impressão da lista de ingressos.',
        ],
        tips: [
            'Venda online: o cliente já recebe o QR na compra — este cadastro é mais para emissão manual/portaria.',
            'Depois de gerar, teste na tela do validador com a chave do evento.',
            'Se o evento ainda não estiver ativo/publicado, ative-o antes do dia do evento.',
        ],
    },
    'validation-keys': {
        id: 'validation-keys',
        title: 'Ajuda: chaves de validação',
        subtitle: 'Como liberar a portaria e o balcão com segurança.',
        purpose:
            'A chave de 8 caracteres libera o app/PWA validador sem login de gestor. Cada chave fica ligada a um evento e a um tipo de uso (entrada/saída ou entrega de consumo).',
        requiredFields: [
            {
                field: 'Nome do colaborador/operador',
                detail: 'Quem vai usar a chave na portaria ou no balcão (identificação interna).',
            },
            {
                field: 'Evento específico',
                detail: 'Obrigatório. A chave só valida ingressos daquele evento.',
            },
            {
                field: 'Tipo da chave',
                detail:
                    'Entrada/saída (portaria) ou consumo no balcão (entrega). O plano da empresa precisa permitir o tipo escolhido.',
            },
            {
                field: 'Data de expiração',
                detail:
                    'Calculada a partir da data/hora/duração do evento. A chave deixa de funcionar depois desse horário.',
            },
        ],
        steps: [
            'Clique em “Nova Chave”.',
            'Preencha colaborador, evento e tipo; confira a expiração.',
            'Crie a chave e copie o código de 8 caracteres (ele só aparece completo na criação).',
            'No celular da portaria, abra o validador, digite a chave e valide.',
            'No dia do evento, escaneie o QR do ingresso (entrada/saída) ou o QR de entrega (consumo).',
        ],
        tips: [
            'Não compartilhe a mesma chave em vários pontos sem necessidade — prefira uma por operador/setor.',
            'Se a chave vazar, desative e crie outra.',
            'Sem internet estável, a validação fica lenta ou falha: teste a rede do local antes do evento.',
            'Guarde o histórico/logs desta tela para auditar quem validou o quê.',
        ],
        sections: [
            {
                title: 'Diferença dos tipos',
                items: [
                    'Entrada/saída: portaria — registra passagem do ingresso.',
                    'Consumo no balcão: entrega de produto/pedido com crédito EventFest (plano com consumo).',
                ],
            },
        ],
    },
};

export function getManagerScreenGuide(id: ManagerScreenGuideId): ManagerScreenGuide {
    return MANAGER_SCREEN_GUIDES[id];
}

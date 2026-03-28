-- Insere contratos iniciais para 'client_terms' e 'company_registration' se não existirem
-- Conteúdo em dollar-quote com quebras reais no arquivo (evita literais \n no banco).

-- Contrato para Clientes (usuário normal/perfil)
INSERT INTO public.event_contracts (version, title, content, is_active, contract_type)
SELECT
    '1.0',
    'Termos de Uso e Responsabilidade (Cliente)',
    $ct_client$
<h2>TERMO DE USO E RESPONSABILIDADE – USUÁRIO NORMAL (Eventofest)</h2>
<p>Última atualização: 27 de Novembro de 2025</p>
<p>Este documento estabelece os termos e condições de uso aplicáveis aos Usuários cadastrados na plataforma Eventofest, incluindo compradores de ingressos, participantes de eventos e quaisquer indivíduos que utilizem os serviços disponibilizados. Ao prosseguir, você declara que leu, compreendeu e concorda com os termos abaixo.</p>
<h3>1. Aceitação dos Termos</h3>
<p>1.1. Ao acessar, cadastrar-se ou utilizar a plataforma Eventofest, você concorda integralmente com este Termo de Uso e reconhece que está vinculado às regras aqui descritas.</p>
<p>1.2. Caso não concorde com algum ponto deste documento, você não deve utilizar a plataforma nem seus serviços.</p>
<h3>2. Cadastro e Veracidade das Informações</h3>
<p>2.1. Para utilizar certas funcionalidades, é necessário realizar um cadastro, fornecendo informações precisas e verdadeiras.</p>
<p>2.2. Você é o único responsável pela veracidade e atualização dos dados fornecidos, sob pena de bloqueio ou exclusão da conta.</p>
<p>Este é o conteúdo inicial do contrato de USUÁRIO NORMAL. Por favor, edite na área administrativa após o deploy para incluir o conteúdo completo e atualizado.</p>
$ct_client$,
    TRUE,
    'client_terms'
WHERE NOT EXISTS (SELECT 1 FROM public.event_contracts WHERE contract_type = 'client_terms');

-- Contrato para Cadastro de Empresas (Gestor PRO)
INSERT INTO public.event_contracts (version, title, content, is_active, contract_type)
SELECT
    '1.0',
    'Contrato de Adesão de Empresa (Gestor PRO)',
    $ct_company$
<h2>CONTRATO DE ADESÃO DE EMPRESA – GESTOR PRO (Eventofest)</h2>
<p>Última atualização: 27 de Novembro de 2025</p>
<p>Este contrato estabelece os termos e condições para o registro e utilização da plataforma Eventofest por Pessoas Jurídicas (Empresas) como Gestores PRO, incluindo a criação e gerenciamento de eventos, venda de ingressos e acesso a relatórios.</p>
<h3>1. Adesão e Aceitação</h3>
<p>1.1. Ao prosseguir com o cadastro da sua empresa na plataforma Eventofest, você, na qualidade de representante legal da Pessoa Jurídica, declara ter lido, compreendido e aceito integralmente os termos e condições deste contrato.</p>
<p>1.2. A não aceitação destes termos impossibilita o registro da empresa como Gestor PRO.</p>
<h3>2. Obrigações do Gestor PRO</h3>
<p>2.1. O Gestor PRO é responsável pela veracidade das informações cadastrais da empresa e dos eventos criados.</p>
<p>2.2. Deve cumprir todas as leis e regulamentações aplicáveis à realização de eventos e venda de ingressos, incluindo questões fiscais e de segurança.</p>
<p>Este é o conteúdo inicial do contrato de CADASTRO DE EMPRESA. Por favor, edite na área administrativa após o deploy para incluir o conteúdo completo e atualizado.</p>
$ct_company$,
    TRUE,
    'company_registration'
WHERE NOT EXISTS (SELECT 1 FROM public.event_contracts WHERE contract_type = 'company_registration');

/** UFs brasileiras (código IBGE / ViaCEP). */
export const BRAZIL_UF_CODES = [
    'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
    'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

export type BrazilUfCode = (typeof BRAZIL_UF_CODES)[number];

const UF_SET = new Set<string>(BRAZIL_UF_CODES);

const NAME_TO_UF: Record<string, BrazilUfCode> = {
    acre: 'AC',
    alagoas: 'AL',
    amapa: 'AP',
    'amapá': 'AP',
    amazonas: 'AM',
    bahia: 'BA',
    ceara: 'CE',
    'ceará': 'CE',
    'distrito federal': 'DF',
    'espirito santo': 'ES',
    'espírito santo': 'ES',
    goias: 'GO',
    'goiás': 'GO',
    maranhao: 'MA',
    'maranhão': 'MA',
    'mato grosso': 'MT',
    'mato grosso do sul': 'MS',
    'minas gerais': 'MG',
    para: 'PA',
    'pará': 'PA',
    paraiba: 'PB',
    'paraíba': 'PB',
    parana: 'PR',
    'paraná': 'PR',
    pernambuco: 'PE',
    piaui: 'PI',
    'piauí': 'PI',
    'rio de janeiro': 'RJ',
    'rio grande do norte': 'RN',
    'rio grande do sul': 'RS',
    rondonia: 'RO',
    'rondônia': 'RO',
    roraima: 'RR',
    'santa catarina': 'SC',
    'sao paulo': 'SP',
    'são paulo': 'SP',
    sergipe: 'SE',
    tocantins: 'TO',
};

export const UF_LABELS: Record<BrazilUfCode, string> = {
    AC: 'Acre',
    AL: 'Alagoas',
    AP: 'Amapá',
    AM: 'Amazonas',
    BA: 'Bahia',
    CE: 'Ceará',
    DF: 'Distrito Federal',
    ES: 'Espírito Santo',
    GO: 'Goiás',
    MA: 'Maranhão',
    MT: 'Mato Grosso',
    MS: 'Mato Grosso do Sul',
    MG: 'Minas Gerais',
    PA: 'Pará',
    PB: 'Paraíba',
    PR: 'Paraná',
    PE: 'Pernambuco',
    PI: 'Piauí',
    RJ: 'Rio de Janeiro',
    RN: 'Rio Grande do Norte',
    RS: 'Rio Grande do Sul',
    RO: 'Rondônia',
    RR: 'Roraima',
    SC: 'Santa Catarina',
    SP: 'São Paulo',
    SE: 'Sergipe',
    TO: 'Tocantins',
};

/** Normaliza texto de perfil (SP, sp, São Paulo) para código UF ou null. */
export function normalizeBrazilUf(raw: string | null | undefined): BrazilUfCode | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const upper = trimmed.toUpperCase();
    if (UF_SET.has(upper)) return upper as BrazilUfCode;
    const key = trimmed
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
    const withAccents = trimmed.toLowerCase().replace(/\s+/g, ' ').trim();
    return NAME_TO_UF[withAccents] ?? NAME_TO_UF[key] ?? null;
}

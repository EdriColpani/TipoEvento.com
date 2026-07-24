/** Temas de avaliação de evento (cliente → gestor). */
export const EVENT_REVIEW_TAGS = [
    { id: 'organizacao', label: 'Organização' },
    { id: 'entrada', label: 'Entrada / filas' },
    { id: 'local', label: 'Local / estrutura' },
    { id: 'som', label: 'Som / palco' },
    { id: 'atendimento', label: 'Atendimento' },
    { id: 'custo', label: 'Custo-benefício' },
] as const;

export const RATING_LABELS: Record<number, string> = {
    1: 'Péssimo',
    2: 'Ruim',
    3: 'Regular',
    4: 'Bom',
    5: 'Excelente',
};

export function ratingStarsLabel(rating: number): string {
    const safe = Math.max(1, Math.min(5, Math.round(rating)));
    return `${'★'.repeat(safe)}${'☆'.repeat(5 - safe)}`;
}

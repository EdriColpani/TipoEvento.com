import type { PublicEvent } from '@/hooks/use-public-events';

export const LANDING_CATEGORY_DEFINITIONS = [
    { id: 1, name: 'Música', icon: 'fas fa-music' },
    { id: 2, name: 'Negócios', icon: 'fas fa-briefcase' },
    { id: 3, name: 'Arte', icon: 'fas fa-palette' },
    { id: 4, name: 'Gastronomia', icon: 'fas fa-utensils' },
    { id: 5, name: 'Tecnologia', icon: 'fas fa-laptop' },
    { id: 6, name: 'Esportes', icon: 'fas fa-trophy' },
] as const;

export type LandingCategoryCard = {
    id: number | string;
    name: string;
    icon: string;
    count: number;
};

/** Compara categorias ignorando maiúsculas e acentos. */
export function normalizeCategoryKey(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '');
}

export function categoriesMatch(a: string, b: string): boolean {
    if (!a.trim() || !b.trim()) return false;
    return normalizeCategoryKey(a) === normalizeCategoryKey(b);
}

export function buildLandingCategoryCards(events: PublicEvent[]): LandingCategoryCard[] {
    const counts = new Map<string, { name: string; count: number }>();

    for (const event of events) {
        const raw = (event.category || '').trim();
        if (!raw) continue;
        const key = normalizeCategoryKey(raw);
        const existing = counts.get(key);
        if (existing) {
            existing.count += 1;
        } else {
            counts.set(key, { name: raw, count: 1 });
        }
    }

    const usedKeys = new Set<string>();
    const cards: LandingCategoryCard[] = [];

    for (const def of LANDING_CATEGORY_DEFINITIONS) {
        const key = normalizeCategoryKey(def.name);
        const stat = counts.get(key);
        cards.push({
            id: def.id,
            name: def.name,
            icon: def.icon,
            count: stat?.count ?? 0,
        });
        usedKeys.add(key);
    }

    for (const [key, stat] of counts) {
        if (usedKeys.has(key)) continue;
        cards.push({
            id: `custom-${key}`,
            name: stat.name,
            icon: 'fas fa-tag',
            count: stat.count,
        });
    }

    return cards;
}

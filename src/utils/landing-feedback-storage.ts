export type StoredLandingFeedback = {
    id: string;
    message: string;
    created_at: string;
};

const STORAGE_KEY = 'eventfest_landing_feedback_v1';

export function readStoredLandingFeedback(): StoredLandingFeedback[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as StoredLandingFeedback[];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function appendStoredLandingFeedback(entry: StoredLandingFeedback): void {
    const list = readStoredLandingFeedback();
    list.unshift(entry);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 50)));
}

export function removeStoredLandingFeedback(id: string): void {
    const list = readStoredLandingFeedback().filter((f) => f.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

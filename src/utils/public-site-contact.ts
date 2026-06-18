export type PublicSiteContact = {
    phone: string | null;
    company_name: string;
    instagram_handle: string;
    linkedin_url: string | null;
};

export const DEFAULT_PUBLIC_SITE_CONTACT: PublicSiteContact = {
    phone: null,
    company_name: 'EventFest',
    instagram_handle: 'eventfest.app',
    linkedin_url: null,
};

export function normalizeInstagramHandle(value: string): string {
    return value.trim().replace(/^@+/, '').replace(/\s+/g, '');
}

export function buildInstagramUrl(handle: string): string {
    const normalized = normalizeInstagramHandle(handle);
    return normalized ? `https://instagram.com/${normalized}` : 'https://instagram.com/';
}

export function normalizeLinkedInUrl(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
}

export function parsePublicSiteContact(data: unknown): PublicSiteContact {
    const row = (data ?? {}) as Record<string, unknown>;
    const handle = normalizeInstagramHandle(String(row.instagram_handle ?? 'eventfest.app')) || 'eventfest.app';
    const linkedin = row.linkedin_url;
    return {
        phone: row.phone != null && String(row.phone).trim() !== '' ? String(row.phone) : null,
        company_name: String(row.company_name ?? 'EventFest').trim() || 'EventFest',
        instagram_handle: handle,
        linkedin_url:
            linkedin != null && String(linkedin).trim() !== '' ? String(linkedin).trim() : null,
    };
}

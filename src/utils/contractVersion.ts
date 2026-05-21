/** Incrementa versão semântica simples: 1.0 → 1.1, 2 → 2.1, v3 → v3.1 */
export function bumpContractVersion(current: string): string {
    const trimmed = (current || '1.0').trim();
    const match = trimmed.match(/^v?(\d+)(?:\.(\d+))?$/i);
    if (match) {
        const major = parseInt(match[1], 10);
        const minor = match[2] !== undefined ? parseInt(match[2], 10) + 1 : 1;
        const prefix = /^v/i.test(trimmed) ? 'v' : '';
        return `${prefix}${major}.${minor}`;
    }
    return `${trimmed}.1`;
}

export function contractContentChanged(
    previous: { title: string; content: string },
    next: { title: string; content: string },
): boolean {
    return (
        previous.title.trim() !== next.title.trim() ||
        previous.content.trim() !== next.content.trim()
    );
}

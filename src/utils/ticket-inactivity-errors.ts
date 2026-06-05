export function formatTicketInactivityError(message: string): string {
    const lower = message.toLowerCase();
    if (lower.includes('inatividade comercial') || lower.includes('pendência de inatividade')) {
        return message.replace(/^ERROR:\s*/i, '').trim();
    }
    return message;
}

export function isTicketInactivityError(message: string): boolean {
    const lower = message.toLowerCase();
    return lower.includes('inatividade comercial') || lower.includes('pendência de inatividade');
}

/** Mensagens amigáveis para erros do trigger de mínimo de ingressos / ativação. */
export function formatMinEventTicketsActivationError(message: string): string {
    const lower = message.toLowerCase();
    if (
        lower.includes('pulseiras ativas') ||
        lower.includes('cadastre pelo menos') ||
        lower.includes('ativar o evento')
    ) {
        return message
            .replace(/^ERROR:\s*/i, '')
            .replace(/pulseiras ativas/gi, 'ingressos ativos')
            .replace(/pulseiras/gi, 'ingressos')
            .trim();
    }
    if (lower.includes('exige evento pago') || lower.includes('alterar para gratuito')) {
        return 'Seu plano exige eventos pagos. Não é permitido marcar o evento como gratuito.';
    }
    return message;
}

import { buildComplimentaryBundleUrl, buildComplimentarySeatUrl } from '@/utils/public-app-url';

export function buildBundleWhatsAppMessage(input: {
    recipientName: string;
    eventTitle: string;
    quantity: number;
    batchName: string;
    publicToken: string;
    expiresAt?: string;
}): string {
    const link = buildComplimentaryBundleUrl(input.publicToken);
    const expiry = input.expiresAt
        ? new Date(input.expiresAt).toLocaleDateString('pt-BR')
        : null;
    const lines = [
        `Olá, ${input.recipientName}!`,
        '',
        `Você recebeu um pacote cortesia para *${input.eventTitle}*.`,
        `Tipo: ${input.batchName} · ${input.quantity} ingresso(s).`,
        '',
        'Acesse o link abaixo, entre com sua conta EventFest e distribua os ingressos para quem for utilizar:',
        link,
    ];
    if (expiry) {
        lines.push('', `Válido até ${expiry}.`);
    }
    return lines.join('\n');
}

export function buildSeatWhatsAppMessage(input: {
    eventTitle: string;
    batchName: string;
    seatNumber: number;
    redeemToken: string;
}): string {
    const link = buildComplimentarySeatUrl(input.redeemToken);
    return [
        `Seu ingresso cortesia para *${input.eventTitle}* (${input.batchName}).`,
        `Ingresso ${input.seatNumber} de ${input.batchName}.`,
        '',
        'Entre com sua conta EventFest para resgatar:',
        link,
    ].join('\n');
}

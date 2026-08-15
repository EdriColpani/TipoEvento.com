import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, UserCheck, Clock, Ticket, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn, outlineBtnDarkClass } from '@/lib/utils';

export type ComplimentaryReportSeat = {
    seat_number: number;
    status: string;
    redeemed_at: string | null;
    redeemer_name: string | null;
    redeemer_email: string | null;
    ticket_code: string | null;
};

export type ComplimentaryReportBundle = {
    bundle_id: string;
    event_id: string;
    event_title: string;
    recipient_name: string;
    recipient_email: string | null;
    quantity: number;
    redeemed_count: number;
    available_count: number;
    status: string;
    expires_at: string;
    created_at: string;
    holder_claimed: boolean;
    holder_claimed_at: string | null;
    email_sent_at: string | null;
    notes: string | null;
    seats: ComplimentaryReportSeat[];
};

const SEAT_STATUS_LABELS: Record<string, string> = {
    available: 'Disponível',
    redeemed: 'Resgatado',
    cancelled: 'Cancelado',
};

export function formatReportDateTime(value: string | null | undefined): string {
    if (!value) return '—';
    return new Date(value).toLocaleString('pt-BR');
}

function seatCounts(seats: ComplimentaryReportSeat[], quantity: number) {
    const redeemed = seats.filter((s) => s.status === 'redeemed').length;
    const available = seats.filter((s) => s.status === 'available').length;
    const cancelled = seats.filter((s) => s.status === 'cancelled').length;
    return {
        redeemed,
        available,
        cancelled,
        total: quantity || seats.length,
    };
}

function expiryHint(status: string, expiresAt: string): string {
    const end = new Date(expiresAt);
    if (Number.isNaN(end.getTime())) return '';
    const now = new Date();
    const diffMs = end.getTime() - now.getTime();
    const days = Math.round(Math.abs(diffMs) / 86_400_000);
    if (status === 'expired' || diffMs < 0) {
        return days <= 0 ? 'Expirou hoje' : `Expirou há ${days} dia${days === 1 ? '' : 's'}`;
    }
    if (days === 0) return 'Expira hoje';
    return `Expira em ${days} dia${days === 1 ? '' : 's'}`;
}

function bundleSituation(row: ComplimentaryReportBundle, counts: ReturnType<typeof seatCounts>): string {
    if (row.status === 'expired' && counts.redeemed === 0) {
        return `Pacote expirado. Nenhum dos ${counts.total} ingressos foi resgatado — os convites foram cancelados automaticamente.`;
    }
    if (row.status === 'expired' && counts.redeemed > 0) {
        return `Pacote expirado. ${counts.redeemed} ingresso(s) resgatado(s) antes do prazo; ${counts.cancelled} cancelado(s).`;
    }
    if (row.status === 'cancelled') {
        return `Pacote cancelado pelo gestor. ${counts.redeemed} resgatado(s), ${counts.cancelled} cancelado(s).`;
    }
    if (row.status === 'fully_redeemed') {
        return `Todos os ${counts.total} ingressos foram resgatados.`;
    }
    if (counts.available > 0) {
        return `${counts.available} ingresso(s) ainda disponível(is) para resgate. ${counts.redeemed} já resgatado(s).`;
    }
    return 'Acompanhe o uso de cada ingresso abaixo.';
}

const ComplimentaryReportBundleDetails: React.FC<{ row: ComplimentaryReportBundle }> = ({ row }) => {
    const navigate = useNavigate();
    const seats = row.seats ?? [];
    const counts = seatCounts(seats, row.quantity);
    const hasRedeemed = counts.redeemed > 0;
    const hint = expiryHint(row.status, row.expires_at);

    return (
        <div className="mx-3 mb-3 mt-1 rounded-xl border border-yellow-500/30 bg-black p-4 sm:p-5 space-y-4">
            <p className="text-sm text-gray-200 leading-relaxed">{bundleSituation(row, counts)}</p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="rounded-lg border border-yellow-500/20 bg-black/60 px-3 py-2">
                    <p className="text-[11px] text-gray-400 flex items-center gap-1">
                        <Ticket className="h-3 w-3 text-yellow-500" /> Ingressos
                    </p>
                    <p className="text-white font-semibold tabular-nums">{counts.total}</p>
                </div>
                <div className="rounded-lg border border-yellow-500/20 bg-black/60 px-3 py-2">
                    <p className="text-[11px] text-gray-400">Resgatados</p>
                    <p className="text-white font-semibold tabular-nums">
                        {counts.redeemed}/{counts.total}
                    </p>
                </div>
                <div className="rounded-lg border border-yellow-500/20 bg-black/60 px-3 py-2">
                    <p className="text-[11px] text-gray-400">Disponíveis</p>
                    <p className="text-white font-semibold tabular-nums">{counts.available}</p>
                </div>
                <div className="rounded-lg border border-yellow-500/20 bg-black/60 px-3 py-2">
                    <p className="text-[11px] text-gray-400">Cancelados</p>
                    <p className="text-white font-semibold tabular-nums">{counts.cancelled}</p>
                </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-2 text-xs text-gray-300">
                <p className="flex items-start gap-2">
                    <Mail className="h-3.5 w-3.5 text-yellow-500 mt-0.5 shrink-0" />
                    <span>
                        {row.email_sent_at
                            ? `E-mail enviado em ${formatReportDateTime(row.email_sent_at)}`
                            : row.recipient_email
                              ? `E-mail cadastrado (${row.recipient_email}), envio não registrado`
                              : 'Sem e-mail do destinatário'}
                    </span>
                </p>
                <p className="flex items-start gap-2">
                    <UserCheck className="h-3.5 w-3.5 text-yellow-500 mt-0.5 shrink-0" />
                    <span>
                        {row.holder_claimed
                            ? `Destinatário acessou o link${row.holder_claimed_at ? ` em ${formatReportDateTime(row.holder_claimed_at)}` : ''}`
                            : 'Destinatário ainda não abriu o link do pacote'}
                    </span>
                </p>
                <p className="flex items-start gap-2">
                    <Clock className="h-3.5 w-3.5 text-yellow-500 mt-0.5 shrink-0" />
                    <span>
                        Criado em {formatReportDateTime(row.created_at)}
                        {hint ? ` · ${hint}` : ''}
                    </span>
                </p>
                {row.notes ? (
                    <p className="flex items-start gap-2 sm:col-span-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 mt-0.5 shrink-0" />
                        <span>Observação: {row.notes}</span>
                    </p>
                ) : null}
            </div>

            {hasRedeemed ? (
                <div className="overflow-x-auto rounded-lg border border-yellow-500/20">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-yellow-500/20 bg-black">
                                <th className="px-3 py-2 text-left text-xs font-semibold text-yellow-500">Nº</th>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-yellow-500">Status</th>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-yellow-500">Quem resgatou</th>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-yellow-500">Código</th>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-yellow-500">Quando</th>
                            </tr>
                        </thead>
                        <tbody>
                            {seats
                                .filter((s) => s.status === 'redeemed')
                                .map((seat) => (
                                    <tr
                                        key={seat.seat_number}
                                        className="border-b border-yellow-500/10 last:border-0"
                                    >
                                        <td className="px-3 py-2.5 text-white tabular-nums">{seat.seat_number}</td>
                                        <td className="px-3 py-2.5 text-white">Resgatado</td>
                                        <td className="px-3 py-2.5">
                                            <div className="text-gray-200">{seat.redeemer_name ?? '—'}</div>
                                            {seat.redeemer_email ? (
                                                <div className="text-xs text-gray-500">{seat.redeemer_email}</div>
                                            ) : null}
                                        </td>
                                        <td className="px-3 py-2.5 font-mono text-xs text-yellow-500">
                                            {seat.ticket_code ?? '—'}
                                        </td>
                                        <td className="px-3 py-2.5 text-xs text-gray-400">
                                            {formatReportDateTime(seat.redeemed_at)}
                                        </td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className="rounded-lg border border-yellow-500/20 bg-black/60 px-3 py-3 text-sm text-gray-300">
                    Nenhum ingresso deste pacote foi resgatado.
                    {counts.cancelled > 0
                        ? ` ${counts.cancelled} convite(s) constam como cancelado(s).`
                        : counts.available > 0
                          ? ` Ainda há ${counts.available} convite(s) disponível(is).`
                          : ''}
                </div>
            )}

            {seats.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {seats.map((seat) => (
                        <span
                            key={seat.seat_number}
                            className={cn(
                                'text-xs px-2 py-1 rounded-full border',
                                seat.status === 'redeemed'
                                    ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-500'
                                    : seat.status === 'available'
                                      ? 'border-yellow-500/20 text-gray-200'
                                      : 'border-red-500/30 bg-red-950/40 text-red-200',
                            )}
                            title={SEAT_STATUS_LABELS[seat.status] ?? seat.status}
                        >
                            #{seat.seat_number} {SEAT_STATUS_LABELS[seat.status] ?? seat.status}
                        </span>
                    ))}
                </div>
            )}

            <Button
                size="sm"
                variant="outline"
                className={outlineBtnDarkClass}
                onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/manager/events/${row.event_id}/cortesias`);
                }}
            >
                Gerenciar pacotes deste evento
            </Button>
        </div>
    );
};

export default ComplimentaryReportBundleDetails;

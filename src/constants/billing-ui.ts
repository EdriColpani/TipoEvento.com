/** Padrão visual — área de planos/cobrança (ciano sobre fundo escuro). */

const btnBase = 'inline-flex items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 disabled:pointer-events-none disabled:opacity-50';

/** Primário: fundo ciano, texto preto (Adicionar faixa, Nova cobrança, Confirmar) */
export const billingBtnSolid = `${btnBase} bg-cyan-400 text-black hover:bg-cyan-300 font-semibold shadow-sm shadow-cyan-500/25`;

/** Voltar / secundário: contorno ciano, fundo escuro */
export const billingBtnBack = `${btnBase} bg-transparent border border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10 font-medium`;

/** Secundário: contorno ciano, fundo transparente (Mostrar histórico, Cancelar) */
export const billingBtnGhost = `${btnBase} bg-transparent border border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10 font-medium`;

/** Confirmar plano em card âmbar */
export const billingBtnOutline = `${btnBase} bg-transparent border border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10 font-semibold`;

/** Ícone editar na tabela */
export const billingBtnIconEdit = `${btnBase} h-8 w-8 p-0 bg-transparent border border-cyan-500/50 text-cyan-500 hover:bg-cyan-500/10`;

/** Contorno amarelo (painel gestor / empresas admin) */
export const adminBtnOutline = `${btnBase} bg-transparent border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 font-medium`;

/** Ícone desativar / perigo: borda vermelha */
export const billingBtnIconDanger = `${btnBase} h-8 w-8 p-0 bg-transparent border border-red-500/50 text-red-500 hover:bg-red-500/10`;

/** Ação positiva em linha (Marcar pago) — contorno verde suave ou sólido ciano pequeno */
export const billingBtnSuccessSm = `${btnBase} h-8 px-3 text-sm bg-cyan-400/90 text-black hover:bg-cyan-300 font-medium`;

/** Ação neutra em linha (Cancelar cobrança) */
export const billingBtnMutedSm = `${btnBase} h-8 px-3 text-sm bg-transparent border border-gray-500/40 text-gray-400 hover:bg-white/5`;

/** Badge plano atual */
export const billingBadgeCurrent =
    'text-xs px-2.5 py-1 rounded-full bg-cyan-500/15 text-cyan-400 ring-1 ring-cyan-400/40';

export const billingCardCurrent = 'border-cyan-500/50 bg-cyan-500/5';
export const billingCardDefault = 'border-amber-500/35 bg-black/40';
export const billingCardMuted = 'border-cyan-500/20 bg-black/40';

export const billingPanelBorder = 'border-cyan-500/30';
export const billingDialogSurface = 'bg-black border-cyan-500/30 text-white';
export const billingTableHead = 'text-cyan-400';
export const billingAccentText = 'text-cyan-400';
export const billingSpinner = 'text-cyan-400';
export const billingInput = 'bg-black/60 border-cyan-500/30 text-white';

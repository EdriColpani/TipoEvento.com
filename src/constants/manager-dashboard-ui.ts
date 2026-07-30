/**
 * Paleta do dashboard do gestor — alinhada a billing-ui (ciano sobre fundo escuro).
 * Sem amarelo nesta superfície de analytics.
 */

export const dashPanel =
    'bg-black border border-cyan-500/30 rounded-2xl p-5 sm:p-6 shadow-lg shadow-cyan-500/5';

export const dashPanelHover =
    'hover:border-cyan-400/50 transition-all duration-300';

export const dashAccent = 'text-cyan-400';
export const dashMuted = 'text-gray-400';
export const dashSpinner = 'text-cyan-400';
export const dashTitle = 'text-lg sm:text-xl font-semibold text-white';

export const dashBtnSolid =
    'bg-cyan-400 text-black hover:bg-cyan-300 font-semibold shadow-sm shadow-cyan-500/25';

export const dashBtnGhost =
    'bg-transparent border border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10 font-medium';

export const dashIconTone = {
    tickets: { wrap: 'bg-cyan-500/20', icon: 'text-cyan-400' },
    revenue: { wrap: 'bg-emerald-500/20', icon: 'text-emerald-400' },
    checkins: { wrap: 'bg-sky-500/20', icon: 'text-sky-400' },
    credits: { wrap: 'bg-violet-500/20', icon: 'text-violet-400' },
    events: { wrap: 'bg-blue-500/20', icon: 'text-blue-400' },
    today: { wrap: 'bg-cyan-500/15', icon: 'text-cyan-400' },
} as const;

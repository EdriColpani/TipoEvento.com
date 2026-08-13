import { Star } from 'lucide-react';

type PrincipalReportBadgeProps = {
    label?: string;
};

/** Selo visual dos relatórios financeiros principais (gestor e Admin). */
export function PrincipalReportBadge({ label = 'Relatório principal' }: PrincipalReportBadgeProps) {
    return (
        <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-black">
            <Star className="h-3 w-3 fill-black" />
            {label}
        </span>
    );
}

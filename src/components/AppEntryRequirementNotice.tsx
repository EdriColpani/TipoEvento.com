"use client";

import React from 'react';
import { Smartphone } from 'lucide-react';
import { APP_ENTRY_NOTICE } from '@/constants/app-entry-notice';
import { cn } from '@/lib/utils';

type NoticeVariant = 'full' | 'compact';

interface AppEntryRequirementNoticeProps {
    variant?: NoticeVariant;
    className?: string;
}

/**
 * Informa o cliente sobre o app obrigatório na entrada e o uso do QR Code.
 * Visível em Meus Ingressos e no modal do QR após a compra.
 */
const AppEntryRequirementNotice: React.FC<AppEntryRequirementNoticeProps> = ({
    variant = 'full',
    className,
}) => {
    if (variant === 'compact') {
        return (
            <div
                role="note"
                className={cn(
                    'rounded-lg border border-amber-500/40 bg-amber-950/50 p-3 text-left text-xs text-amber-50/95',
                    className,
                )}
            >
                <p className="font-semibold text-amber-200 mb-1 flex items-center gap-1.5">
                    <Smartphone className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {APP_ENTRY_NOTICE.title}
                </p>
                <p className="leading-relaxed text-amber-100/90">{APP_ENTRY_NOTICE.shortHint}</p>
            </div>
        );
    }

    return (
        <aside
            role="region"
            aria-label={APP_ENTRY_NOTICE.title}
            className={cn(
                'rounded-xl border border-amber-500/40 bg-amber-950/60 p-4 sm:p-5 text-amber-50',
                className,
            )}
        >
            <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/20 border border-amber-500/40">
                    <Smartphone className="h-5 w-5 text-amber-300" aria-hidden />
                </div>
                <div className="min-w-0 space-y-2">
                    <h3 className="text-base sm:text-lg font-semibold text-amber-200">
                        {APP_ENTRY_NOTICE.title}
                    </h3>
                    <p className="text-sm text-amber-100/95 leading-relaxed">{APP_ENTRY_NOTICE.lead}</p>
                    <ul className="list-disc pl-4 space-y-1.5 text-sm text-amber-50/90 leading-relaxed">
                        {APP_ENTRY_NOTICE.bullets.map((item) => (
                            <li key={item}>{item}</li>
                        ))}
                    </ul>
                </div>
            </div>
        </aside>
    );
};

export default AppEntryRequirementNotice;

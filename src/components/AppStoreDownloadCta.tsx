import React, { useMemo } from 'react';
import { Download, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ANDROID_PLAY_STORE_URL, IOS_APP_STORE_URL } from '@/constants/app-store-links';
import { detectMobilePlatform } from '@/utils/detect-mobile-platform';
import { cn } from '@/lib/utils';

type AppStoreDownloadCtaProps = {
    /** client = cadastro cliente; pro = cadastro gestor */
    variant?: 'client' | 'pro';
    className?: string;
};

export default function AppStoreDownloadCta({
    variant = 'client',
    className,
}: AppStoreDownloadCtaProps) {
    const platform = useMemo(() => detectMobilePlatform(), []);
    const isPro = variant === 'pro';

    const blurb =
        isPro
            ? 'Baixe o EventFest Rush para validar e gerenciar no celular.'
            : 'Baixe o EventFest Rush para comprar e usar seus ingressos.';

    const accentBorder = isPro ? 'border-yellow-500/25 bg-yellow-500/5' : 'border-cyan-500/25 bg-cyan-500/5';
    const accentText = isPro ? 'text-yellow-500' : 'text-cyan-400';

    if (platform === 'other') {
        return (
            <div
                className={cn(
                    'flex gap-3 rounded-xl border p-4 text-left',
                    accentBorder,
                    className,
                )}
            >
                <Smartphone className={cn('h-5 w-5 shrink-0 mt-0.5', accentText)} />
                <div className="text-sm">
                    <p className="font-medium text-white">Aplicativo EventFest Rush</p>
                    <p className="text-gray-400 mt-1 leading-relaxed">
                        {blurb} Abra esta página no celular para ver o botão da loja (App Store ou Google Play).
                    </p>
                </div>
            </div>
        );
    }

    const href = platform === 'ios' ? IOS_APP_STORE_URL : ANDROID_PLAY_STORE_URL;
    const label = platform === 'ios' ? 'Baixar na App Store' : 'Baixar no Google Play';

    return (
        <div
            className={cn(
                'flex flex-col gap-3 rounded-xl border p-4 text-left',
                accentBorder,
                className,
            )}
        >
            <div className="flex gap-3">
                <Download className={cn('h-5 w-5 shrink-0 mt-0.5', accentText)} />
                <div className="text-sm">
                    <p className="font-medium text-white">Aplicativo EventFest Rush</p>
                    <p className="text-gray-400 mt-1 leading-relaxed">{blurb}</p>
                </div>
            </div>
            <Button
                type="button"
                asChild
                className="w-full bg-yellow-500 text-black hover:bg-yellow-600 font-semibold"
            >
                <a href={href} target="_blank" rel="noopener noreferrer">
                    <Download className="h-4 w-4 mr-2 shrink-0" />
                    {label}
                </a>
            </Button>
        </div>
    );
}

"use client";

import React, { useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import ManagerScreenHelpDialog from '@/components/ManagerScreenHelpDialog';
import type { ManagerScreenGuideId } from '@/constants/manager-screen-guides';

type ManagerScreenHelpButtonProps = {
    guideId: ManagerScreenGuideId;
    /** Texto do botão outline no cabeçalho */
    label?: string;
    /** Link discreto abaixo do título/descrição */
    linkLabel?: string;
    className?: string;
    /** Só o botão do header (padrão) ou também o link “Para que serve” */
    showLink?: boolean;
};

/**
 * Botão "?" / “Como preencher” no padrão da Central de Relatórios (accent cyan).
 */
const ManagerScreenHelpButton: React.FC<ManagerScreenHelpButtonProps> = ({
    guideId,
    label = 'Como preencher',
    linkLabel = 'Para que serve esta tela?',
    className,
    showLink = false,
}) => {
    const [open, setOpen] = useState(false);

    return (
        <>
            <div className={cn('flex flex-col items-start gap-2', className)}>
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => setOpen(true)}
                    className="bg-black/60 border border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/10 hover:text-cyan-300 text-sm"
                >
                    <CircleHelp className="mr-2 h-4 w-4" />
                    {label}
                </Button>
                {showLink ? (
                    <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 underline-offset-2 hover:underline"
                        onClick={() => setOpen(true)}
                    >
                        <CircleHelp className="h-3.5 w-3.5" />
                        {linkLabel}
                    </button>
                ) : null}
            </div>
            <ManagerScreenHelpDialog open={open} onOpenChange={setOpen} guideId={guideId} />
        </>
    );
};

export default ManagerScreenHelpButton;

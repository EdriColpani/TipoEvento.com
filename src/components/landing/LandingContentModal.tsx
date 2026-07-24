import React from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { LandingModalId } from '@/contexts/LandingUiContext';

const TITLES: Record<Exclude<LandingModalId, null>, string> = {
    about: 'Sobre Nós',
    'how-it-works': 'Como Funciona',
    'help-center': 'Central de Ajuda',
    faq: 'Perguntas Frequentes (FAQ)',
    feedback: 'Feedback',
};

type LandingContentModalProps = {
    modalId: LandingModalId;
    onClose: () => void;
    children: React.ReactNode;
    description?: string;
    className?: string;
};

const LandingContentModal: React.FC<LandingContentModalProps> = ({
    modalId,
    onClose,
    children,
    description,
    className,
}) => {
    const open = modalId !== null;
    const title = modalId ? TITLES[modalId] : '';

    return (
        <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
            <DialogContent
                className={cn(
                    'max-h-[min(90vh,820px)] overflow-y-auto sm:max-w-[640px] bg-black/95 border border-cyan-400/30 text-white',
                    className,
                )}
            >
                <DialogHeader>
                    <DialogTitle className="text-cyan-400 text-xl sm:text-2xl font-serif pr-8">
                        {title}
                    </DialogTitle>
                    {description ? (
                        <DialogDescription className="text-gray-400">{description}</DialogDescription>
                    ) : null}
                </DialogHeader>
                <div className="text-gray-300 text-sm sm:text-base leading-relaxed">{children}</div>
            </DialogContent>
        </Dialog>
    );
};

export default LandingContentModal;

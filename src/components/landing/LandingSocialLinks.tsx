import React from 'react';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type LandingSocialLinksProps = {
    className?: string;
    iconClassName?: string;
};

const LandingSocialLinks: React.FC<LandingSocialLinksProps> = ({
    className,
    iconClassName = 'text-xl sm:text-2xl',
}) => {
    return (
        <TooltipProvider delayDuration={200}>
            <div className={cn('flex space-x-4', className)}>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <a
                            href="https://instagram.com/eventfest.contato"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-yellow-500 hover:text-cyan-300 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded"
                            aria-label="Instagram EventFest"
                        >
                            <i className={cn('fab fa-instagram', iconClassName)} />
                        </a>
                    </TooltipTrigger>
                    <TooltipContent
                        side="top"
                        className="bg-black/95 border border-cyan-400/40 text-cyan-300 text-xs font-medium shadow-lg animate-in fade-in-0 zoom-in-95"
                    >
                        eventfest.contato
                    </TooltipContent>
                </Tooltip>

                <a
                    href="https://twitter.com/eventfest"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-yellow-500 hover:text-cyan-300 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded"
                    aria-label="Twitter / X EventFest"
                >
                    <i className={cn('fab fa-twitter', iconClassName)} />
                </a>

                <a
                    href="https://linkedin.com/company/eventfest"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-yellow-500 hover:text-cyan-300 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded"
                    aria-label="LinkedIn EventFest"
                >
                    <i className={cn('fab fa-linkedin', iconClassName)} />
                </a>
            </div>
        </TooltipProvider>
    );
};

export default LandingSocialLinks;

import React from 'react';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { usePublicSiteContact } from '@/hooks/use-public-site-contact';
import { buildInstagramUrl } from '@/utils/public-site-contact';

type LandingSocialLinksProps = {
    className?: string;
    iconClassName?: string;
};

const LandingSocialLinks: React.FC<LandingSocialLinksProps> = ({
    className,
    iconClassName = 'text-xl sm:text-2xl',
}) => {
    const { contact } = usePublicSiteContact();
    const instagramUrl = buildInstagramUrl(contact.instagram_handle);
    const linkedinUrl = contact.linkedin_url;

    return (
        <TooltipProvider delayDuration={200}>
            <div className={cn('flex space-x-4', className)}>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <a
                            href={instagramUrl}
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
                        @{contact.instagram_handle}
                    </TooltipContent>
                </Tooltip>

                {linkedinUrl ? (
                    <a
                        href={linkedinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-yellow-500 hover:text-cyan-300 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded"
                        aria-label="LinkedIn EventFest"
                    >
                        <i className={cn('fab fa-linkedin', iconClassName)} />
                    </a>
                ) : null}
            </div>
        </TooltipProvider>
    );
};

export default LandingSocialLinks;

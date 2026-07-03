import React from 'react';
import { cn } from '@/lib/utils';
import { SITE_LOGO_ALT, SITE_LOGO_SRC } from '@/constants/branding';

type SiteLogoProps = {
    className?: string;
    onClick?: () => void;
    /** Remove o fundo preto do PNG no tema escuro (mix-blend-lighten). */
    transparentOnDark?: boolean;
};

const SiteLogo: React.FC<SiteLogoProps> = ({
    className,
    onClick,
    transparentOnDark = true,
}) => (
    <img
        src={SITE_LOGO_SRC}
        alt={SITE_LOGO_ALT}
        className={cn(
            'w-auto object-contain',
            transparentOnDark && 'mix-blend-lighten',
            onClick && 'cursor-pointer',
            className,
        )}
        onClick={onClick}
        onKeyDown={
            onClick
                ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onClick();
                      }
                  }
                : undefined
        }
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
    />
);

export default SiteLogo;

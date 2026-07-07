import React from 'react';
import { cn } from '@/lib/utils';
import { SITE_LOGO_ALT, SITE_LOGO_FEATURE_CLASS, SITE_LOGO_HEADER_CLASS, SITE_LOGO_SRC } from '@/constants/branding';

type SiteLogoProps = {
    className?: string;
    onClick?: () => void;
    /** PNG com fundo preto sólido (legado). A oficial usa RGBA — não precisa. */
    transparentOnDark?: boolean;
    /** Header do site / painel gestor. */
    header?: boolean;
    /** Telas centrais de autenticação (login, nova senha). */
    feature?: boolean;
};

const SiteLogo: React.FC<SiteLogoProps> = ({
    className,
    onClick,
    transparentOnDark = false,
    header = false,
    feature = false,
}) => (
    <img
        src={SITE_LOGO_SRC}
        alt={SITE_LOGO_ALT}
        className={cn(
            'w-auto object-contain object-left',
            header && SITE_LOGO_HEADER_CLASS,
            feature && SITE_LOGO_FEATURE_CLASS,
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

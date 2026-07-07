import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
    CLIENT_ACCOUNT_OUTLINE_BTN_CLASS,
    CLIENT_ACCOUNT_PAGE_CLASS,
    CLIENT_ACCOUNT_TITLE_CLASS,
} from '@/constants/client-account-ui';

type ClientAccountPageShellProps = {
    title: string;
    subtitle?: string;
    icon?: React.ReactNode;
    headerAction?: React.ReactNode;
    showBackToProfile?: boolean;
    children: React.ReactNode;
    className?: string;
};

export function ClientAccountBackToProfileButton() {
    const navigate = useNavigate();

    return (
        <Button
            type="button"
            onClick={() => navigate('/profile')}
            variant="outline"
            className={CLIENT_ACCOUNT_OUTLINE_BTN_CLASS}
        >
            <i className="fas fa-user-circle mr-2" aria-hidden />
            Voltar ao Perfil
        </Button>
    );
}

const ClientAccountPageShell: React.FC<ClientAccountPageShellProps> = ({
    title,
    subtitle,
    icon,
    headerAction,
    showBackToProfile = false,
    children,
    className,
}) => {
    const resolvedAction =
        headerAction ?? (showBackToProfile ? <ClientAccountBackToProfileButton /> : null);

    return (
        <div className={cn(CLIENT_ACCOUNT_PAGE_CLASS, className)}>
            <div
                className={cn(
                    'mb-8 flex flex-col gap-4',
                    resolvedAction && 'sm:flex-row sm:items-center sm:justify-between',
                )}
            >
                <div className="flex min-w-0 items-start gap-3">
                    {icon ? <div className="mt-1 shrink-0">{icon}</div> : null}
                    <div className="min-w-0">
                        <h1 className={CLIENT_ACCOUNT_TITLE_CLASS}>{title}</h1>
                        {subtitle ? <p className="mt-1 text-sm text-gray-400">{subtitle}</p> : null}
                    </div>
                </div>
                {resolvedAction ? <div className="shrink-0">{resolvedAction}</div> : null}
            </div>
            {children}
        </div>
    );
};

export default ClientAccountPageShell;

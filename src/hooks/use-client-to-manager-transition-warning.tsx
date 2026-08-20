import { useCallback, useRef, useState } from 'react';
import ClientToManagerTransitionWarningDialog from '@/components/ClientToManagerTransitionWarningDialog';
import { usePublicSiteAuth } from '@/contexts/PublicLaunchModeContext';
import { normalizeTipoUsuarioId } from '@/utils/fetch-profile-tipo';

const CLIENT_USER_TYPE_ID = 3;

/**
 * Exibe aviso irreversível quando um cliente logado (tipo 3) inicia cadastro de gestor.
 * Visitantes ou contas já gestor/admin seguem direto sem modal.
 */
export function useClientToManagerTransitionWarning() {
    const { isAuthenticated, tipoUsuarioId, profile } = usePublicSiteAuth();
    const [open, setOpen] = useState(false);
    const pendingActionRef = useRef<(() => void) | null>(null);

    const resolvedTipo =
        normalizeTipoUsuarioId(tipoUsuarioId) ?? normalizeTipoUsuarioId(profile?.tipo_usuario_id);

    const isClientAccount = isAuthenticated && resolvedTipo === CLIENT_USER_TYPE_ID;

    const requestClientToManagerTransition = useCallback(
        (onConfirm: () => void) => {
            if (!isClientAccount) {
                onConfirm();
                return;
            }
            pendingActionRef.current = onConfirm;
            setOpen(true);
        },
        [isClientAccount],
    );

    const handleConfirm = useCallback(() => {
        const action = pendingActionRef.current;
        pendingActionRef.current = null;
        action?.();
    }, []);

    const handleOpenChange = useCallback((next: boolean) => {
        setOpen(next);
        if (!next) {
            pendingActionRef.current = null;
        }
    }, []);

    const transitionWarningDialog = (
        <ClientToManagerTransitionWarningDialog
            open={open}
            onOpenChange={handleOpenChange}
            onConfirm={handleConfirm}
        />
    );

    return {
        isClientAccount,
        requestClientToManagerTransition,
        transitionWarningDialog,
    };
}

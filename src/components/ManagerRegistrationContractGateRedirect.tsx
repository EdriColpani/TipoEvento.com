import React, { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { Navigate, useLocation } from 'react-router-dom';
import { usePublicSiteAuth } from '@/contexts/PublicLaunchModeContext';
import { normalizeTipoUsuarioId } from '@/utils/fetch-profile-tipo';
import { MANAGER_REGISTRATION_GATE_TOAST } from '@/constants/manager-onboarding-gate';
import { useManagerRegistrationContractGateStatus } from '@/hooks/use-manager-registration-contract-gate';
import {
    isManagerRegistrationContractPath,
    MANAGER_REGISTRATION_CONTRACT_PATH,
} from '@/utils/manager-registration-contract-gate';
import { showError } from '@/utils/toast';

const MANAGER_USER_TYPE_ID = 2;

type Props = {
    /** Exibe spinner enquanto resolve o gate (evita flash de conteúdo errado). */
    showLoading?: boolean;
    children?: React.ReactNode;
};

/**
 * Redireciona gestor com empresa criada mas contrato de cadastro pendente
 * para /manager/register. Empresa já existe — não recadastrar PJ/PF.
 */
const ManagerRegistrationContractGateRedirect: React.FC<Props> = ({
    showLoading = false,
    children = null,
}) => {
    const location = useLocation();
    const toastShown = useRef(false);
    const { userId, isAuthenticated, tipoUsuarioId, profile, sessionReady } = usePublicSiteAuth();

    const resolvedTipo =
        normalizeTipoUsuarioId(tipoUsuarioId) ?? normalizeTipoUsuarioId(profile?.tipo_usuario_id);
    const isManagerPro = isAuthenticated && resolvedTipo === MANAGER_USER_TYPE_ID;

    const { pendingContractSigning, isLoading, isFetching } = useManagerRegistrationContractGateStatus(
        userId,
        isManagerPro && sessionReady,
    );

    const onContractPath = isManagerRegistrationContractPath(location.pathname);

    useEffect(() => {
        if (!pendingContractSigning || onContractPath) {
            toastShown.current = false;
            return;
        }
        if (!toastShown.current) {
            toastShown.current = true;
            showError(MANAGER_REGISTRATION_GATE_TOAST);
        }
    }, [pendingContractSigning, onContractPath]);

    if (!isManagerPro || !sessionReady) {
        return <>{children}</>;
    }

    if (isLoading || (isFetching && !pendingContractSigning && !onContractPath)) {
        if (!showLoading) return <>{children}</>;
        return (
            <div className="flex min-h-[40vh] flex-col items-center justify-center bg-black px-4">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500" />
            </div>
        );
    }

    if (!pendingContractSigning) {
        return <>{children}</>;
    }

    if (onContractPath) {
        return <>{children}</>;
    }

    return <Navigate to={MANAGER_REGISTRATION_CONTRACT_PATH} replace />;
};

export default ManagerRegistrationContractGateRedirect;

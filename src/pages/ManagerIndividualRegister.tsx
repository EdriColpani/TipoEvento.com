import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import ManagerIndividualRegisterDialog from '@/components/ManagerIndividualRegisterDialog';
import { usePageAuth } from '@/hooks/use-page-auth';
import { useProfile } from '@/hooks/use-profile';
import { MANAGER_ACCOUNT_REGISTER_PATH } from '@/utils/promoter-registration-flow';
import { postponeCompanyRegistration } from '@/utils/manager-company-registration';

const ManagerIndividualRegister: React.FC = () => {
    const navigate = useNavigate();
    const { userId, authPending, sessionReady } = usePageAuth(8_000);
    const { profile, isLoading: isLoadingProfile } = useProfile(userId);

    const leaveToHome = () => {
        postponeCompanyRegistration();
        navigate('/');
    };

    useEffect(() => {
        if (authPending || !sessionReady || userId) return;
        navigate(MANAGER_ACCOUNT_REGISTER_PATH, { replace: true });
    }, [authPending, sessionReady, userId, navigate]);

    if (authPending || (Boolean(userId) && isLoadingProfile)) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
            </div>
        );
    }

    if (!userId) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center px-4 sm:px-6 py-12">
            <div className="relative z-10 w-full max-w-4xl">
                <div className="text-center mb-6">
                    <button
                        type="button"
                        className="text-3xl font-serif text-yellow-500 font-bold mb-2"
                        onClick={leaveToHome}
                    >
                        EventFest
                    </button>
                    <h1 className="text-xl sm:text-2xl font-semibold text-white mb-2">
                        Cadastro de Gestor (Pessoa Física)
                    </h1>
                    <p className="text-gray-400 text-sm sm:text-base">
                        E-mail confirmado. Preencha seus dados. Em seguida você assina o contrato.
                    </p>
                </div>
                <ManagerIndividualRegisterDialog
                    isOpen
                    onClose={leaveToHome}
                    profile={profile}
                    userId={userId}
                />
            </div>
        </div>
    );
};

export default ManagerIndividualRegister;

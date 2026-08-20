import React from 'react';
import { Outlet } from 'react-router-dom';
import ManagerRegistrationContractGateRedirect from '@/components/ManagerRegistrationContractGateRedirect';

/** Cadastros públicos + gate: empresa já criada → só assinar contrato em /manager/register. */
const PublicLaunchRegistrationGuard: React.FC = () => (
    <>
        <ManagerRegistrationContractGateRedirect showLoading />
        <Outlet />
    </>
);

export default PublicLaunchRegistrationGuard;

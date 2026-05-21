import { Navigate } from 'react-router-dom';

/** Legado: credenciais de ingressos ficam no Perfil da Empresa → aba Ingressos MP. */
const ManagerPaymentSettings = () => (
    <Navigate to="/manager/settings/company-profile?tab=payments" replace />
);

export default ManagerPaymentSettings;

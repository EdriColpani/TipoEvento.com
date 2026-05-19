import { Navigate } from 'react-router-dom';

/** Redireciona rota legada para Preços e comissões (aba ingressos). */
const AdminCommissionTiers: React.FC = () => (
    <Navigate to="/admin/settings/pricing?tab=tickets" replace />
);

export default AdminCommissionTiers;

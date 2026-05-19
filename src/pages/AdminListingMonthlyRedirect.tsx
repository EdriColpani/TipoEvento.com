import { Navigate } from 'react-router-dom';

const AdminListingMonthlyRedirect: React.FC = () => (
    <Navigate to="/admin/settings/monthly-invoices" replace />
);

export default AdminListingMonthlyRedirect;

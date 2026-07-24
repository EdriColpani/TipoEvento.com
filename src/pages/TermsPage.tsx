import React from 'react';
import LegalDocumentPage from '@/components/landing/LegalDocumentPage';
import LandingTermsBody from '@/components/landing/LandingTermsBody';

const TermsPage: React.FC = () => (
    <LegalDocumentPage title="Termos de Uso" documentTitle="Termos de Uso | EventFest">
        <LandingTermsBody />
    </LegalDocumentPage>
);

export default TermsPage;

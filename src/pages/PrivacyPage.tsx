import React from 'react';
import LegalDocumentPage from '@/components/landing/LegalDocumentPage';
import LandingTermsBody from '@/components/landing/LandingTermsBody';
import { LANDING_PRIVACY_SECTIONS } from '@/constants/landing-content';

const PrivacyPage: React.FC = () => (
    <LegalDocumentPage
        title="Política de Privacidade"
        documentTitle="Política de Privacidade | EventFest"
    >
        <LandingTermsBody sections={LANDING_PRIVACY_SECTIONS} />
    </LegalDocumentPage>
);

export default PrivacyPage;

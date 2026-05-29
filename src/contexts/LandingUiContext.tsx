import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export type LandingModalId =
    | 'about'
    | 'how-it-works'
    | 'terms'
    | 'privacy'
    | 'help-center'
    | 'faq'
    | 'feedback'
    | null;

type LandingUiContextValue = {
    contactOpen: boolean;
    toggleContact: () => void;
    openContact: () => void;
    closeContact: () => void;
    activeModal: LandingModalId;
    openModal: (id: Exclude<LandingModalId, null>) => void;
    closeModal: () => void;
};

const LandingUiContext = createContext<LandingUiContextValue | null>(null);

export function LandingUiProvider({ children }: { children: React.ReactNode }) {
    const location = useLocation();
    const navigate = useNavigate();
    const [contactOpen, setContactOpen] = useState(false);
    const [activeModal, setActiveModal] = useState<LandingModalId>(null);

    const scrollToContactSection = useCallback(() => {
        window.setTimeout(() => {
            const target =
                document.getElementById('landing-contact-panel') ?? document.getElementById('contato');
            target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 200);
    }, []);

    const goToContactSection = useCallback(() => {
        setContactOpen(true);
        if (location.pathname !== '/') {
            navigate('/#contato');
            return;
        }
        scrollToContactSection();
    }, [location.pathname, navigate, scrollToContactSection]);

    const openContact = useCallback(() => {
        goToContactSection();
    }, [goToContactSection]);

    const closeContact = useCallback(() => {
        setContactOpen(false);
    }, []);

    const toggleContact = useCallback(() => {
        if (location.pathname !== '/') {
            goToContactSection();
            return;
        }
        setContactOpen((prev) => {
            const next = !prev;
            if (next) scrollToContactSection();
            return next;
        });
    }, [location.pathname, goToContactSection, scrollToContactSection]);

    const openModal = useCallback((id: Exclude<LandingModalId, null>) => {
        setActiveModal(id);
    }, []);

    const closeModal = useCallback(() => {
        setActiveModal(null);
    }, []);

    useEffect(() => {
        if (location.pathname !== '/' || location.hash !== '#contato') return;
        setContactOpen(true);
        scrollToContactSection();
    }, [location.pathname, location.hash, scrollToContactSection]);

    const value = useMemo(
        () => ({
            contactOpen,
            toggleContact,
            openContact,
            closeContact,
            activeModal,
            openModal,
            closeModal,
        }),
        [contactOpen, toggleContact, openContact, closeContact, activeModal, openModal, closeModal],
    );

    return <LandingUiContext.Provider value={value}>{children}</LandingUiContext.Provider>;
}

export function useLandingUi(): LandingUiContextValue {
    const ctx = useContext(LandingUiContext);
    if (!ctx) {
        throw new Error('useLandingUi must be used within LandingUiProvider');
    }
    return ctx;
}

export function useLandingUiOptional(): LandingUiContextValue | null {
    return useContext(LandingUiContext);
}

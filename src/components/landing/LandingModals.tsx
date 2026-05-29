import React from 'react';
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from '@/components/ui/accordion';
import {
    LANDING_ABOUT_CONTENT,
    LANDING_FAQ_ITEMS,
    LANDING_HELP_CENTER_SECTIONS,
    LANDING_HOW_IT_WORKS,
    LANDING_PRIVACY_CONTENT,
} from '@/constants/landing-content';
import type { LandingModalId } from '@/contexts/LandingUiContext';
import LandingContentModal from '@/components/landing/LandingContentModal';
import LandingFeedbackPanel from '@/components/landing/LandingFeedbackPanel';
import LandingTermsBody from '@/components/landing/LandingTermsBody';

type LandingModalsProps = {
    activeModal: LandingModalId;
    onClose: () => void;
};

const LandingModals: React.FC<LandingModalsProps> = ({ activeModal, onClose }) => {
    const renderBody = () => {
        switch (activeModal) {
            case 'about':
                return <p className="whitespace-pre-line">{LANDING_ABOUT_CONTENT}</p>;
            case 'how-it-works':
                return (
                    <ul className="space-y-4">
                        {LANDING_HOW_IT_WORKS.map((step) => (
                            <li
                                key={step.title}
                                className="rounded-xl border border-cyan-400/20 bg-black/50 p-4"
                            >
                                <h4 className="text-cyan-400 font-semibold mb-2">{step.title}</h4>
                                <p className="text-gray-300">{step.body}</p>
                            </li>
                        ))}
                    </ul>
                );
            case 'terms':
                return <LandingTermsBody />;
            case 'privacy':
                return <p className="whitespace-pre-line">{LANDING_PRIVACY_CONTENT}</p>;
            case 'help-center':
                return (
                    <div className="space-y-4">
                        {LANDING_HELP_CENTER_SECTIONS.map((section) => (
                            <div
                                key={section.title}
                                className="rounded-xl border border-cyan-400/20 bg-black/50 p-4"
                            >
                                <h4 className="text-cyan-400 font-semibold mb-2">{section.title}</h4>
                                <ul className="list-disc list-inside space-y-1 text-gray-300">
                                    {section.items.map((item) => (
                                        <li key={item}>{item}</li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                );
            case 'faq':
                return (
                    <Accordion type="single" collapsible className="w-full">
                        {LANDING_FAQ_ITEMS.map((item, idx) => (
                            <AccordionItem
                                key={item.question}
                                value={`faq-${idx}`}
                                className="border-cyan-400/20"
                            >
                                <AccordionTrigger className="text-left text-white hover:text-cyan-400 hover:no-underline">
                                    {item.question}
                                </AccordionTrigger>
                                <AccordionContent className="text-gray-300">{item.answer}</AccordionContent>
                            </AccordionItem>
                        ))}
                    </Accordion>
                );
            case 'feedback':
                return <LandingFeedbackPanel />;
            default:
                return null;
        }
    };

    if (!activeModal) return null;

    if (activeModal === 'feedback') {
        return (
            <LandingContentModal
                modalId={activeModal}
                onClose={onClose}
                description="Sua opinião ajuda a melhorar a EventFest."
                className="sm:max-w-[560px]"
            >
                {renderBody()}
            </LandingContentModal>
        );
    }

    return (
        <LandingContentModal modalId={activeModal} onClose={onClose}>
            {renderBody()}
        </LandingContentModal>
    );
};

export default LandingModals;

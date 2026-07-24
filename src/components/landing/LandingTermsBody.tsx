import React from 'react';
import {
    LANDING_TERMS_SECTIONS,
    type LandingTermsSection,
} from '@/constants/landing-content';

type LandingTermsBodyProps = {
    sections?: LandingTermsSection[];
};

const LandingTermsBody: React.FC<LandingTermsBodyProps> = ({
    sections = LANDING_TERMS_SECTIONS,
}) => (
    <div className="space-y-5 text-sm text-gray-300">
        {sections.map((section) => (
            <section
                key={section.title}
                className="rounded-xl border border-cyan-400/20 bg-black/50 p-4"
            >
                <h4 className="text-cyan-400 font-semibold mb-3">{section.title}</h4>
                {section.paragraphs?.map((text) => (
                    <p key={text} className="mb-2 last:mb-0">
                        {text}
                    </p>
                ))}
                {section.listIntro && <p className="mb-2">{section.listIntro}</p>}
                {section.bullets && (
                    <ul className="list-disc list-inside space-y-1 mb-2">
                        {section.bullets.map((item) => (
                            <li key={item}>{item}</li>
                        ))}
                    </ul>
                )}
                {section.paragraphsAfter?.map((text) => (
                    <p key={text} className="mb-2 last:mb-0">
                        {text}
                    </p>
                ))}
                {section.listIntro2 && <p className="mb-2 mt-2">{section.listIntro2}</p>}
                {section.bullets2 && (
                    <ul className="list-disc list-inside space-y-1">
                        {section.bullets2.map((item) => (
                            <li key={item}>{item}</li>
                        ))}
                    </ul>
                )}
            </section>
        ))}
    </div>
);

export default LandingTermsBody;

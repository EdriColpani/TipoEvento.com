import React from 'react';
import {
    CONTRACT_HTML_PROSE_BILLING_CLASS,
    CONTRACT_HTML_PROSE_CLASS,
    prepareContractContentForHtmlDisplay,
} from '@/utils/contractContent';

interface ContractHtmlBodyProps {
    content: string;
    variant?: 'default' | 'billing';
    className?: string;
}

const ContractHtmlBody: React.FC<ContractHtmlBodyProps> = ({
    content,
    variant = 'default',
    className = '',
}) => {
    const html = prepareContractContentForHtmlDisplay(content);
    const proseClass = variant === 'billing' ? CONTRACT_HTML_PROSE_BILLING_CLASS : CONTRACT_HTML_PROSE_CLASS;

    return <div className={`${proseClass} ${className}`.trim()} dangerouslySetInnerHTML={{ __html: html }} />;
};

export default ContractHtmlBody;

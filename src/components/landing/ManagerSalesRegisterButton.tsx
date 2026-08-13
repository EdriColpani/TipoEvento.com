import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const PRIMARY_BTN =
    'bg-yellow-500 text-black hover:bg-yellow-600 disabled:opacity-50 font-semibold';

type Props = {
    label: string;
    onClick: () => void;
    className?: string;
};

/** CTA primário EventFest → cadastro de gestor/empresa */
const ManagerSalesRegisterButton: React.FC<Props> = ({ label, onClick, className }) => (
    <Button type="button" onClick={onClick} className={cn(PRIMARY_BTN, 'px-8 py-6 text-base', className)}>
        {label}
        <ArrowRight className="ml-2 h-4 w-4" />
    </Button>
);

export default ManagerSalesRegisterButton;

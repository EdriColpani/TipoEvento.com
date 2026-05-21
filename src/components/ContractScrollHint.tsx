import { AlertTriangle } from 'lucide-react';

interface ContractScrollHintProps {
    visible: boolean;
    className?: string;
}

/** Aviso exibido até o usuário rolar o contrato até o final. */
const ContractScrollHint: React.FC<ContractScrollHintProps> = ({
    visible,
    className = 'text-xs text-amber-400 mt-2 flex items-start gap-1',
}) => {
    if (!visible) return null;
    return (
        <p className={className}>
            <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
            Role o contrato até o final para habilitar a opção &quot;Li e aceito&quot;.
        </p>
    );
};

export default ContractScrollHint;

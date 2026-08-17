import React, { useState } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { showError, showSuccess } from '@/utils/toast';

type CopyableIdProps = {
    value: string;
    label?: string;
};

const CopyableId: React.FC<CopyableIdProps> = ({ value, label = 'ID' }) => {
    const [busy, setBusy] = useState(false);

    const handleCopy = async () => {
        if (!value || busy) return;
        setBusy(true);
        try {
            await navigator.clipboard.writeText(value);
            showSuccess(`${label} copiado.`);
        } catch {
            showError(`Não foi possível copiar o ${label.toLowerCase()}.`);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="mt-1 flex items-center gap-1 min-w-0">
            <code className="text-[11px] font-mono text-yellow-500/90 break-all">{value}</code>
            <Button
                type="button"
                size="sm"
                variant="ghost"
                title={`Copiar ${label.toLowerCase()}`}
                onClick={() => void handleCopy()}
                className="h-6 w-6 p-0 shrink-0 bg-transparent text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
            >
                <Copy className="h-3 w-3" />
            </Button>
        </div>
    );
};

export default CopyableId;

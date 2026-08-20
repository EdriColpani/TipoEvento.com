import React from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import { CLIENT_TO_MANAGER_TRANSITION } from '@/constants/client-to-manager-transition';

const OUTLINE_BTN =
    'bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400';

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
};

const ClientToManagerTransitionWarningDialog: React.FC<Props> = ({ open, onOpenChange, onConfirm }) => {
    const copy = CLIENT_TO_MANAGER_TRANSITION;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg bg-black/95 border border-yellow-500/30 text-white max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="text-yellow-500 font-serif text-xl flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 shrink-0" />
                        {copy.title}
                    </DialogTitle>
                    <DialogDescription className="text-gray-400 text-sm leading-relaxed pt-1">
                        {copy.lead}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 text-sm">
                    <div className="rounded-xl border border-amber-500/40 bg-amber-950/60 p-4 text-amber-50">
                        <p className="font-semibold text-amber-100 mb-1">Atenção — mudança permanente</p>
                        <p className="leading-relaxed">{copy.irreversible}</p>
                    </div>

                    <div>
                        <p className="text-gray-300 font-medium mb-2">O que pode ocorrer ao continuar:</p>
                        <ul className="list-disc list-inside space-y-2 text-gray-400 leading-relaxed">
                            {copy.bullets.map((item) => (
                                <li key={item}>{item}</li>
                            ))}
                        </ul>
                    </div>

                    <p className="text-gray-500 text-xs leading-relaxed border-t border-yellow-500/15 pt-3">
                        {copy.tip}
                    </p>
                </div>

                <DialogFooter className="flex-col-reverse sm:flex-row gap-2 sm:gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        className={`w-full sm:w-auto ${OUTLINE_BTN}`}
                        onClick={() => onOpenChange(false)}
                    >
                        {copy.cancel}
                    </Button>
                    <Button
                        type="button"
                        className="w-full sm:w-auto bg-yellow-500 text-black hover:bg-yellow-600"
                        onClick={() => {
                            onConfirm();
                            onOpenChange(false);
                        }}
                    >
                        {copy.confirm}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default ClientToManagerTransitionWarningDialog;

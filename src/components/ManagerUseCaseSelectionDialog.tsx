"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Building2, Loader2, Store, Ticket } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ManagerRegistrationUseCase } from '@/constants/company-kind';

interface ManagerUseCaseSelectionDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectUseCase: (useCase: ManagerRegistrationUseCase) => void;
    isSubmitting: boolean;
}

const ManagerUseCaseSelectionDialog: React.FC<ManagerUseCaseSelectionDialogProps> = ({
    isOpen,
    onClose,
    onSelectUseCase,
    isSubmitting,
}) => {
    const [selected, setSelected] = useState<ManagerRegistrationUseCase | null>(null);

    const handleConfirm = () => {
        if (selected) onSelectUseCase(selected);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[800px] bg-black/90 border border-yellow-500/30 text-white p-6">
                <DialogHeader>
                    <DialogTitle className="text-yellow-500 text-2xl">Como você vai usar a EventFest?</DialogTitle>
                    <DialogDescription className="text-gray-400">
                        Escolha o perfil que melhor descreve seu negócio. Isso define o plano recomendado e o menu do painel.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div
                        className={cn(
                            'flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all duration-200',
                            selected === 'organizer'
                                ? 'border-yellow-500 bg-yellow-500/10'
                                : 'border-yellow-500/30 hover:border-yellow-500/60',
                        )}
                        onClick={() => setSelected('organizer')}
                    >
                        <Checkbox
                            checked={selected === 'organizer'}
                            onCheckedChange={() => setSelected('organizer')}
                            className="mt-1 border-yellow-500 data-[state=checked]:bg-yellow-500 data-[state=checked]:text-black"
                        />
                        <Ticket className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-white font-medium">Organizador de eventos</p>
                            <p className="text-gray-400 text-sm mt-1">
                                Divulgação, venda de ingressos e/ou consumo interno no seu evento.
                            </p>
                        </div>
                    </div>
                    <div
                        className={cn(
                            'flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all duration-200',
                            selected === 'partner'
                                ? 'border-yellow-500 bg-yellow-500/10'
                                : 'border-yellow-500/30 hover:border-yellow-500/60',
                        )}
                        onClick={() => setSelected('partner')}
                    >
                        <Checkbox
                            checked={selected === 'partner'}
                            onCheckedChange={() => setSelected('partner')}
                            className="mt-1 border-yellow-500 data-[state=checked]:bg-yellow-500 data-[state=checked]:text-black"
                        />
                        <Store className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-white font-medium">Empresa parceira (consumo)</p>
                            <p className="text-gray-400 text-sm mt-1">
                                Bar, food truck ou loja na rede EventFest — PDV e catálogo de produtos, sem venda de ingressos.
                            </p>
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button
                        onClick={handleConfirm}
                        disabled={!selected || isSubmitting}
                        className="w-full bg-yellow-500 text-black hover:bg-yellow-600 py-3 font-semibold"
                    >
                        {isSubmitting ? (
                            <span className="flex items-center justify-center">
                                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                                Confirmando...
                            </span>
                        ) : (
                            'Continuar'
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default ManagerUseCaseSelectionDialog;

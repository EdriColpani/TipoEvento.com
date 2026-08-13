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
import { Loader2, Store, Ticket } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ManagerRegistrationUseCase } from '@/constants/company-kind';

interface ManagerUseCaseSelectionDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectUseCase: (useCase: ManagerRegistrationUseCase) => void;
    isSubmitting: boolean;
}

const USE_CASE_OPTIONS: Array<{
    id: ManagerRegistrationUseCase;
    title: string;
    summary: string;
    idealFor: string;
    includes: string[];
    excludes: string;
    Icon: typeof Ticket;
}> = [
    {
        id: 'organizer',
        title: 'Organizador de eventos',
        summary:
            'Você é dono ou responsável pelo evento: cria a página, vende ingresso e pode também operar consumo (pulseira/crédito) no local.',
        idealFor:
            'Festas, shows, rodeios, campeonatos, casas de show, produtores e arenas que montam o evento.',
        includes: [
            'Criar e publicar o evento na EventFest',
            'Vender ingressos (online e/ou na porta)',
            'Gestão de lista, check-in e relatórios do evento',
            'Opcional: consumo interno (bar, food, créditos) no seu evento',
        ],
        excludes: 'Não use esta opção se você só opera um bar/loja dentro do evento de outra pessoa.',
        Icon: Ticket,
    },
    {
        id: 'partner',
        title: 'Empresa parceira (consumo)',
        summary:
            'Você não organiza o evento: entra na rede EventFest para vender produtos/consumo em eventos de organizadores, com PDV e catálogo.',
        idealFor: 'Bar, food truck, lanchonete, loja de souvenirs ou qualquer ponto de venda dentro do evento.',
        includes: [
            'Catálogo de produtos e preços',
            'PDV (ponto de venda) e operadores de caixa',
            'Vendas de consumo na rede EventFest',
            'Repasse/financeiro do que você vendeu',
        ],
        excludes:
            'Sem criar evento próprio e sem vender ingressos — quem faz isso é o organizador.',
        Icon: Store,
    },
];

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
            <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto bg-black/90 border border-yellow-500/30 text-white p-6">
                <DialogHeader>
                    <DialogTitle className="text-yellow-500 text-2xl">Como você vai usar a EventFest?</DialogTitle>
                    <DialogDescription className="text-gray-400">
                        A escolha muda o plano sugerido e o menu do painel. Veja a diferença com exemplos antes de
                        continuar.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    {USE_CASE_OPTIONS.map(({ id, title, summary, idealFor, includes, excludes, Icon }) => {
                        const isSelected = selected === id;
                        return (
                            <div
                                key={id}
                                className={cn(
                                    'flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all duration-200',
                                    isSelected
                                        ? 'border-yellow-500 bg-yellow-500/10'
                                        : 'border-yellow-500/30 hover:border-yellow-500/60',
                                )}
                                onClick={() => setSelected(id)}
                            >
                                <Checkbox
                                    checked={isSelected}
                                    onCheckedChange={() => setSelected(id)}
                                    className="mt-1 border-yellow-500 data-[state=checked]:bg-yellow-500 data-[state=checked]:text-black"
                                />
                                <Icon className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
                                <div className="min-w-0 space-y-2">
                                    <p className="text-white font-medium">{title}</p>
                                    <p className="text-gray-300 text-sm leading-relaxed">{summary}</p>
                                    <p className="text-yellow-500/90 text-sm">
                                        <span className="font-medium text-yellow-500">Exemplo: </span>
                                        {idealFor}
                                    </p>
                                    <ul className="text-gray-400 text-sm space-y-1 list-disc list-inside">
                                        {includes.map((item) => (
                                            <li key={item}>{item}</li>
                                        ))}
                                    </ul>
                                    <p className="text-xs text-gray-500 leading-relaxed">{excludes}</p>
                                </div>
                            </div>
                        );
                    })}
                </div>
                <DialogFooter>
                    <Button
                        onClick={handleConfirm}
                        disabled={!selected || isSubmitting}
                        className="w-full bg-yellow-500 text-black hover:bg-yellow-600 py-3 font-semibold disabled:opacity-50"
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

"use client";

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Loader2, Save, Hash, Percent } from 'lucide-react';
import { showSuccess, showError, showLoading, dismissToast } from '@/utils/toast';
import { restPatch, restPost } from '@/utils/supabase-rest';

// Zod schema para validação
const commissionTierSchema = z.object({
    min_tickets: z.union([z.number().min(1, "Mínimo de ingressos deve ser 1 ou mais."), z.literal('')]).transform(e => e === '' ? 0 : Number(e)),
    max_tickets: z.union([z.number().min(1, "Máximo de ingressos deve ser 1 ou mais."), z.literal('')]).transform(e => e === '' ? 0 : Number(e)),
    percentage: z.string().min(1, "Taxa de comissão é obrigatória."),
}).refine((data) => data.min_tickets <= data.max_tickets, {
    message: "O mínimo deve ser menor ou igual ao máximo.",
    path: ["max_tickets"],
});

type CommissionTierFormData = z.infer<typeof commissionTierSchema>;

interface CommissionTierFormProps {
    initialData?: { id: string, min_tickets: number, max_tickets: number, percentage: number, active?: boolean };
    onSaveSuccess: () => void;
    onCancel: () => void;
    userId: string;
    existingRanges?: Array<{ id: string, min_tickets: number, max_tickets: number }>;
}

// Função utilitária para formatar a entrada do usuário (apenas dígitos e vírgula, limitando a 2 casas decimais)
const formatRateInput = (value: string): string => {
    let cleanValue = value.replace(/[^\d,]/g, '');
    const parts = cleanValue.split(',');
    if (parts.length > 2) {
        cleanValue = parts[0] + ',' + parts.slice(1).join('');
    }
    if (parts.length > 0 && cleanValue.includes(',')) {
        const decimalPart = cleanValue.split(',')[1];
        if (decimalPart && decimalPart.length > 2) {
            cleanValue = cleanValue.split(',')[0] + ',' + decimalPart.substring(0, 2);
        }
    }
    return cleanValue;
};

const CommissionTierForm: React.FC<CommissionTierFormProps> = ({ initialData, onSaveSuccess, onCancel, userId, existingRanges = [] }) => {
    const [isSaving, setIsSaving] = useState(false);

    const form = useForm<CommissionTierFormData>({
        resolver: zodResolver(commissionTierSchema),
        defaultValues: {
            min_tickets: initialData?.min_tickets || 1,
            max_tickets: initialData?.max_tickets || 999999,
            // Formata a taxa de comissão para string com vírgula
            percentage: initialData?.percentage ? initialData.percentage.toFixed(2).replace('.', ',') : '0,00',
        },
    });
    
    const handleRateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const formattedRate = formatRateInput(e.target.value);
        form.setValue('percentage', formattedRate, { shouldValidate: true });
    };
    
    const handleRateBlur = () => {
        // Converte para float usando ponto, e formata para duas casas decimais com vírgula
        const numericValue = parseFloat(form.getValues('percentage').replace(',', '.') || '0');
        if (isNaN(numericValue)) {
            form.setValue('percentage', '0,00');
        } else {
            form.setValue('percentage', numericValue.toFixed(2).replace('.', ','));
        }
    };

    // Função para verificar sobreposição de faixas
    const checkOverlap = (min: number, max: number, excludeId?: string): boolean => {
        return existingRanges.some(range => {
            if (excludeId && range.id === excludeId) return false;
            // Verifica se há sobreposição: (min1 <= max2) && (min2 <= max1)
            return (range.min_tickets <= max) && (min <= range.max_tickets);
        });
    };

    const onSubmit = async (values: CommissionTierFormData) => {
        setIsSaving(true);
        
        const minTickets = Number(values.min_tickets);
        const maxTickets = Number(values.max_tickets);
        // Converte a taxa de volta para float com ponto para salvar no DB
        const percentageNumeric = parseFloat(values.percentage.replace(',', '.') || '0');
        
        if (percentageNumeric <= 0 || percentageNumeric > 100) {
            showError("A taxa de comissão deve ser entre 0.01% e 100%.");
            setIsSaving(false);
            return;
        }

        if (minTickets > maxTickets) {
            showError("O mínimo de ingressos não pode ser maior que o máximo.");
            setIsSaving(false);
            return;
        }

        // Verifica sobreposição de faixas
        if (checkOverlap(minTickets, maxTickets, initialData?.id)) {
            showError("Esta faixa se sobrepõe com uma faixa existente. As faixas não podem se sobrepor.");
            setIsSaving(false);
            return;
        }
        
        const toastId = showLoading(initialData ? "Atualizando faixa..." : "Criando nova faixa...");

        const dataToSave = {
            min_tickets: minTickets,
            max_tickets: maxTickets,
            percentage: percentageNumeric,
            active: initialData?.active !== undefined ? initialData.active : true,
        };

        try {
            if (initialData) {
                // Guarda o valor anterior no histórico antes de sobrescrever.
                await restPost('commission_ranges_history', {
                    commission_range_id: initialData.id,
                    min_tickets: initialData.min_tickets,
                    max_tickets: initialData.max_tickets,
                    percentage: initialData.percentage,
                }, 15_000);

                await restPatch(`commission_ranges?id=eq.${initialData.id}`, dataToSave, 15_000);
            } else {
                const created = await restPost<Array<{ id: string }>>(
                    'commission_ranges',
                    dataToSave,
                    15_000,
                    { returnRepresentation: true },
                );

                const createdId = created?.[0]?.id;
                if (createdId) {
                    await restPost('commission_ranges_history', {
                        commission_range_id: createdId,
                        min_tickets: minTickets,
                        max_tickets: maxTickets,
                        percentage: percentageNumeric,
                    }, 15_000);
                }
            }

            dismissToast(toastId);
            showSuccess(`Faixa de comissão ${initialData ? 'atualizada' : 'criada'} com sucesso!`);
            onSaveSuccess();

        } catch (e: any) {
            dismissToast(toastId);
            console.error("Erro ao salvar faixa de comissão:", e);
            showError(`Falha ao salvar: ${e.message || 'Erro desconhecido'}`);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <FormField
                        control={form.control}
                        name="min_tickets"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-white flex items-center">
                                    <Hash className="h-4 w-4 mr-2 text-yellow-500" />
                                    Mínimo de Ingressos *
                                </FormLabel>
                                <FormControl>
                                    <Input 
                                        type="number"
                                        placeholder="Ex: 1"
                                        {...field} 
                                        onChange={e => field.onChange(e.target.value === '' ? '' : Number(e.target.value))}
                                        className={`bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 ${form.formState.errors.min_tickets ? 'border-red-500' : ''}`}
                                        min="1"
                                        disabled={isSaving}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="max_tickets"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-white flex items-center">
                                    <Hash className="h-4 w-4 mr-2 text-yellow-500" />
                                    Máximo de Ingressos *
                                </FormLabel>
                                <FormControl>
                                    <Input 
                                        type="number"
                                        placeholder="Ex: 100"
                                        {...field} 
                                        onChange={e => field.onChange(e.target.value === '' ? '' : Number(e.target.value))}
                                        className={`bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 ${form.formState.errors.max_tickets ? 'border-red-500' : ''}`}
                                        min="1"
                                        disabled={isSaving}
                                    />
                                </FormControl>
                                <FormMessage />
                                <p className="text-xs text-gray-500 mt-1">Use 999999 para "ou mais"</p>
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="percentage"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-white flex items-center">
                                    <Percent className="h-4 w-4 mr-2 text-yellow-500" />
                                    Taxa de Comissão (%) *
                                </FormLabel>
                                <FormControl>
                                    <Input 
                                        type="text"
                                        placeholder="Ex: 15,00"
                                        {...field} 
                                        onChange={handleRateChange}
                                        onBlur={handleRateBlur}
                                        className={`bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 ${form.formState.errors.percentage ? 'border-red-500' : ''}`}
                                        disabled={isSaving}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <div className="flex justify-end space-x-4 pt-4 border-t border-yellow-500/20">
                    <Button
                        type="button"
                        onClick={onCancel}
                        variant="outline"
                        className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 py-2 text-base font-semibold transition-all duration-300 cursor-pointer"
                        disabled={isSaving}
                    >
                        Cancelar
                    </Button>
                    <Button
                        type="submit"
                        disabled={isSaving}
                        className="bg-yellow-500 text-black hover:bg-yellow-600 py-2 text-base font-semibold transition-all duration-300 cursor-pointer disabled:opacity-50"
                    >
                        {isSaving ? (
                            <div className="flex items-center justify-center">
                                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                                Salvando...
                            </div>
                        ) : (
                            <>
                                <Save className="mr-2 h-5 w-5" />
                                Salvar Faixa
                            </>
                        )}
                    </Button>
                </div>
            </form>
        </Form>
    );
};

export default CommissionTierForm;
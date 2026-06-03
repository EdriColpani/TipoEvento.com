"use client";

import React from 'react';
import { useFormContext } from 'react-hook-form';
import * as z from 'zod';
import { Input } from '@/components/ui/input';
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { Loader2 } from 'lucide-react';

// --- Utility Functions (Moved from ManagerCompanyProfile.tsx and ManagerCompanyRegister.tsx) ---

const validateCNPJ = (cnpj: string) => {
    const cleanCNPJ = cnpj.replace(/\D/g, '');

    if (cleanCNPJ.length !== 14) return false;

    // Evita CNPJs com todos os dígitos iguais
    if (/^(\d)\1{13}$/.test(cleanCNPJ)) return false;

    let size = cleanCNPJ.length - 2;
    let numbers = cleanCNPJ.substring(0, size);
    const digits = cleanCNPJ.substring(size);
    let sum = 0;
    let pos = size - 7;

    // Validação do primeiro dígito
    for (let i = size; i >= 1; i--) {
        sum += parseInt(numbers.charAt(size - i)) * pos--;
        if (pos < 2) pos = 9;
    }
    let result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    if (result !== parseInt(digits.charAt(0))) return false;

    // Validação do segundo dígito
    size = size + 1;
    numbers = cleanCNPJ.substring(0, size);
    sum = 0;
    pos = size - 7;
    for (let i = size; i >= 1; i--) {
        sum += parseInt(numbers.charAt(size - i)) * pos--;
        if (pos < 2) pos = 9;
    }
    result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    if (result !== parseInt(digits.charAt(1))) return false;

    return true;
};

const formatCNPJ = (value: string) => {
    if (!value) return '';
    const cleanValue = value.replace(/\D/g, '');
    return cleanValue
        .replace(/^(\d{2})(\d)/, '$1.$2')
        .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
        .replace(/\.(\d{3})(\d)/, '.$1/$2')
        .replace(/(\d{4})(\d)/, '$1-$2')
        .replace(/(-\d{2})\d+?$/, '$1');
};

const formatPhone = (value: string) => {
    if (!value) return '';
    const cleanValue = value.replace(/\D/g, '');
    if (cleanValue.length <= 10) {
        return cleanValue.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
    }
    return cleanValue.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
};

const formatCEP = (value: string) => {
    if (!value) return '';
    const cleanValue = value.replace(/\D/g, '');
    return cleanValue
        .replace(/(\d{5})(\d)/, '$1-$2')
        .replace(/(-\d{3})\d+?$/, '$1');
};

// Zod Schema dinâmico para os dados da empresa
export const createCompanySchema = (isManager: boolean) => {
    const baseSchema = z.object({
        corporate_name: z.string().optional(),
        cnpj: z.string().optional().refine((val) => !val || validateCNPJ(val), { message: "CNPJ inválido. Verifique os dígitos." }),
        trade_name: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().email({ message: "E-mail inválido." }).optional(), 
        
        cep: z.string().optional().refine((val) => !val || val.replace(/\D/g, '').length === 8, { message: "CEP inválido (8 dígitos)." }),
        street: z.string().optional(),
        neighborhood: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        number: z.string().optional(),
        complement: z.string().optional().nullable(),
    });

    if (isManager) {
        return baseSchema.extend({
            corporate_name: z.string().min(1, "Razão Social é obrigatória."),
            cnpj: z.string().min(1, "CNPJ é obrigatório.").refine(validateCNPJ, { message: "CNPJ inválido. Verifique os dígitos." }),
            phone: z.string().min(1, "Telefone é obrigatório."),
            email: z.string().email({ message: "E-mail inválido." }).min(1, "E-mail é obrigatório."),
            cep: z.string().min(1, "CEP é obrigatório.").refine((val) => val.replace(/\D/g, '').length === 8, { message: "CEP inválido (8 dígitos)." }),
            street: z.string().min(1, "Rua é obrigatória."),
            neighborhood: z.string().min(1, "Bairro é obrigatório."),
            city: z.string().min(1, "Cidade é obrigatória."),
            state: z.string().min(1, "Estado é obrigatório."),
            number: z.string().min(1, "Número é obrigatório."),
        });
    }
    return baseSchema;
};

export type CompanyFormData = z.infer<ReturnType<typeof createCompanySchema>>;

interface CompanyFormProps {
    isSaving: boolean;
    isCepLoading: boolean;
    fetchAddressByCep: (cep: string) => void;
    isManagerContext: boolean; // Nova prop para indicar se o contexto é de gestor
}

const CompanyForm: React.FC<CompanyFormProps> = ({ isSaving, isCepLoading, fetchAddressByCep, isManagerContext }) => {
    const form = useFormContext<CompanyFormData>();

    const handleCnpjChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const formattedCnpj = formatCNPJ(e.target.value);
        form.setValue('cnpj', formattedCnpj, { shouldValidate: true });
    };

    const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const formattedPhone = formatPhone(e.target.value);
        form.setValue('phone', formattedPhone, { shouldValidate: true });
    };

    const handleCepChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const rawValue = e.target.value;
        const formattedCep = formatCEP(rawValue);
        form.setValue('cep', formattedCep, { shouldValidate: true });

        if (formattedCep.replace(/\D/g, '').length === 8) {
            fetchAddressByCep(formattedCep);
        }
    };

    return (
        <div className="space-y-6">
            {/* Seção de Dados Corporativos */}
            <div className="space-y-6 pt-4">
                <h3 className="text-lg font-semibold text-white border-b border-yellow-500/10 pb-2">Informações da Empresa</h3>
                
                <FormField
                    control={form.control}
                    name="corporate_name"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-white">Razão Social {isManagerContext && '*'}</FormLabel>
                            <FormControl>
                                <Input 
                                    placeholder="Nome da Empresa S.A."
                                    {...field} 
                                    isInvalid={!!form.formState.errors.corporate_name} // Adicionado isInvalid
                                    className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500" 
                                    disabled={isSaving}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="cnpj"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-white">CNPJ {isManagerContext && '*'}</FormLabel>
                            <FormControl>
                                <Input 
                                    placeholder="00.000.000/0000-00"
                                    {...field} 
                                    onChange={handleCnpjChange}
                                    isInvalid={!!form.formState.errors.cnpj} // Adicionado isInvalid
                                    className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500" 
                                    maxLength={18}
                                    disabled={isSaving}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField
                        control={form.control}
                        name="trade_name"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-white">Nome Fantasia</FormLabel>
                                <FormControl>
                                    <Input 
                                        placeholder="Nome Comercial"
                                        {...field} 
                                        isInvalid={!!form.formState.errors.trade_name} // Adicionado isInvalid
                                        className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500" 
                                        disabled={isSaving}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="phone"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-white">Telefone {isManagerContext && '*'}</FormLabel>
                                <FormControl>
                                    <Input 
                                        placeholder="(00) 00000-0000"
                                        {...field} 
                                        onChange={handlePhoneChange}
                                        isInvalid={!!form.formState.errors.phone} // Adicionado isInvalid
                                        className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500" 
                                        maxLength={15}
                                        disabled={isSaving}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>
                
                <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-white">
                                {isManagerContext
                                    ? 'E-mail de acesso (login)'
                                    : 'E-mail da Empresa (Para Notificações)'}{' '}
                                {isManagerContext && '*'}
                            </FormLabel>
                            <FormControl>
                                <Input 
                                    placeholder="contato@empresa.com"
                                    {...field} 
                                    isInvalid={!!form.formState.errors.email} // Adicionado isInvalid
                                    className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500" 
                                    disabled={isSaving}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </div>

            {/* Seção de Endereço */}
            <div className="space-y-6 pt-4 border-t border-yellow-500/10">
                <h3 className="text-lg font-semibold text-white border-b border-yellow-500/10 pb-2">Endereço</h3>
                
                <FormField
                    control={form.control}
                    name="cep"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-white">CEP {isManagerContext && '*'}</FormLabel>
                            <FormControl>
                                <div className="relative">
                                    <Input 
                                        placeholder="00000-000"
                                        {...field} 
                                        onChange={handleCepChange}
                                        disabled={isSaving || isCepLoading} 
                                        isInvalid={!!form.formState.errors.cep} // Adicionado isInvalid
                                        className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 pr-10" 
                                        maxLength={9}
                                    />
                                    {isCepLoading && (
                                        <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                                            <Loader2 className="w-4 h-4 animate-spin text-yellow-500" />
                                        </div>
                                    )}
                                </div>
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="md:col-span-2">
                        <FormField
                            control={form.control}
                            name="street"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-white">Rua {isManagerContext && '*'}</FormLabel>
                                    <FormControl>
                                        <Input 
                                            id="street" 
                                            placeholder="Ex: Av. Paulista" 
                                            {...field} 
                                            disabled={isSaving || isCepLoading} 
                                            isInvalid={!!form.formState.errors.street} // Adicionado isInvalid
                                            className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500" 
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                    <FormField
                        control={form.control}
                        name="number"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-white">Número {isManagerContext && '*'}</FormLabel>
                                <FormControl>
                                    <Input 
                                        id="number" 
                                        placeholder="123" 
                                        {...field} 
                                        disabled={isSaving || isCepLoading} 
                                        isInvalid={!!form.formState.errors.number} // Adicionado isInvalid
                                        className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500" 
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <FormField
                    control={form.control}
                    name="complement"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-white">Complemento (Opcional)</FormLabel>
                            <FormControl>
                                <Input 
                                    placeholder="Apto 101, Bloco B" 
                                    {...field} 
                                    disabled={isSaving || isCepLoading} 
                                    isInvalid={!!form.formState.errors.complement} // Adicionado isInvalid
                                    className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500" 
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <FormField
                        control={form.control}
                        name="neighborhood"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-white">Bairro {isManagerContext && '*'}</FormLabel>
                                <FormControl>
                                    <Input 
                                        placeholder="Jardim Paulista" 
                                        {...field} 
                                        disabled={isSaving || isCepLoading} 
                                        isInvalid={!!form.formState.errors.neighborhood} // Adicionado isInvalid
                                        className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500" 
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="city"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-white">Cidade {isManagerContext && '*'}</FormLabel>
                                <FormControl>
                                    <Input 
                                        placeholder="São Paulo" 
                                        {...field} 
                                        disabled={isSaving || isCepLoading} 
                                        isInvalid={!!form.formState.errors.city} // Adicionado isInvalid
                                        className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500" 
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="state"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-white">Estado {isManagerContext && '*'}</FormLabel>
                                <FormControl>
                                    <Input 
                                        placeholder="SP" 
                                        {...field} 
                                        disabled={isSaving || isCepLoading} 
                                        isInvalid={!!form.formState.errors.state} // Adicionado isInvalid
                                        className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500" 
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>
            </div>
        </div>
    );
};

export default CompanyForm;
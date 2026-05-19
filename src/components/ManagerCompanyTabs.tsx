"use client";

import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { User, Building, Mail, Phone, MapPin, Calendar, Plus, CreditCard } from 'lucide-react';
import CompanyBillingPlanSection from '@/components/CompanyBillingPlanSection';
import { ProfileData } from '@/hooks/use-profile';
import { CompanyFormData } from './CompanyForm'; // Reutilizando o tipo de dados da empresa
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

interface ManagerCompanyTabsProps {
    companyId: string;
    companyData: CompanyFormData;
    profile: ProfileData;
    isSaving: boolean;
    isCepLoading: boolean;
    fetchAddressByCep: (cep: string) => void;
    formComponent: React.ReactNode; // O formulário de edição da empresa
    isAdminMaster?: boolean;
}

// Helper para formatar dados
const formatData = (value: string | number | null | undefined, fallback: string = 'N/A') => {
    if (value === null || value === undefined || value === '') return fallback;
    return value;
};

const ManagerCompanyTabs: React.FC<ManagerCompanyTabsProps> = ({ 
    companyId,
    companyData, 
    profile, 
    isSaving, 
    isCepLoading, 
    fetchAddressByCep, 
    formComponent,
    isAdminMaster = false,
}) => {
    const navigate = useNavigate();
    
    const fullName = `${formatData(profile.first_name)} ${formatData(profile.last_name, '')}`.trim();
    const fullAddress = [
        formatData(profile.rua),
        formatData(profile.numero),
        formatData(profile.complemento, '')
    ].filter(Boolean).join(', ');
    const cityState = `${formatData(profile.cidade, '')} - ${formatData(profile.estado, '')}`.trim();

    return (
        <Tabs defaultValue="company" className="w-full">
            <TabsList className="grid w-full grid-cols-3 bg-black/60 border border-yellow-500/30">
                <TabsTrigger value="company" className="text-white data-[state=active]:bg-yellow-500 data-[state=active]:text-black">
                    <Building className="h-4 w-4 mr-2" />
                    Dados Corporativos
                </TabsTrigger>
                <TabsTrigger value="billing" className="text-white data-[state=active]:bg-yellow-500 data-[state=active]:text-black">
                    <CreditCard className="h-4 w-4 mr-2" />
                    Plano e cobrança
                </TabsTrigger>
                <TabsTrigger value="manager" className="text-white data-[state=active]:bg-yellow-500 data-[state=active]:text-black">
                    <User className="h-4 w-4 mr-2" />
                    Gestor Principal
                </TabsTrigger>
            </TabsList>
            
            {/* Aba 1: Dados Corporativos (Formulário de Edição) */}
            <TabsContent value="company" className="mt-6">
                {formComponent}
            </TabsContent>

            <TabsContent value="billing" className="mt-6">
                <CompanyBillingPlanSection companyId={companyId} isAdminMaster={isAdminMaster} />
            </TabsContent>

            {/* Aba 2: Gestor Principal (Visualização de Dados) */}
            <TabsContent value="manager" className="mt-6">
                <Card className="bg-black/80 backdrop-blur-sm border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10">
                    <CardHeader>
                        <CardTitle className="text-white text-xl sm:text-2xl font-semibold flex items-center">
                            <User className="h-6 w-6 mr-2 text-yellow-500" />
                            Informações Pessoais do Gestor
                        </CardTitle>
                        <CardDescription className="text-gray-400 text-sm">
                            Estes são os dados pessoais do usuário principal associado a esta empresa.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        
                        {/* Dados Pessoais */}
                        <div className="space-y-3 p-4 bg-black/60 rounded-xl border border-yellow-500/20">
                            <h4 className="text-lg font-semibold text-yellow-500">Identificação</h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                                <div className="flex items-center space-x-2">
                                    <User className="h-4 w-4 text-gray-400" />
                                    <span className="text-white font-medium">{fullName}</span>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <i className="fas fa-id-card h-4 w-4 text-gray-400"></i>
                                    <span className="text-white">{formatData(profile.cpf, 'CPF não cadastrado')}</span>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <Calendar className="h-4 w-4 text-gray-400" />
                                    <span className="text-white">{formatData(profile.birth_date, 'Data Nasc. não cadastrada')}</span>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <i className="fas fa-venus-mars h-4 w-4 text-gray-400"></i>
                                    <span className="text-white">{formatData(profile.gender, 'Gênero não especificado')}</span>
                                </div>
                            </div>
                        </div>
                        
                        {/* Contato e Endereço */}
                        <div className="space-y-3 p-4 bg-black/60 rounded-xl border border-yellow-500/20">
                            <h4 className="text-lg font-semibold text-yellow-500">Contato e Localização</h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                                <div className="flex items-center space-x-2 sm:col-span-2">
                                    <Mail className="h-4 w-4 text-gray-400" />
                                    <span className="text-white">{formatData(profile.email, 'E-mail não disponível')}</span>
                                </div>
                                <div className="flex items-center space-x-2 sm:col-span-2">
                                    <MapPin className="h-4 w-4 text-gray-400" />
                                    <span className="text-white">
                                        {fullAddress || 'Endereço não cadastrado'}
                                        {fullAddress && cityState && `, ${cityState}`}
                                    </span>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <Phone className="h-4 w-4 text-gray-400" />
                                    <span className="text-white">{formatData(profile.cep, 'CEP não cadastrado')}</span>
                                </div>
                            </div>
                        </div>

                        {/* Botões de Ação (Atualizados) */}
                        <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4 pt-4 border-t border-yellow-500/10">
                            <Button
                                onClick={() => navigate('/profile')}
                                variant="outline"
                                className="flex-1 bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 py-3 text-base font-semibold transition-all duration-300 cursor-pointer"
                            >
                                <User className="mr-2 h-5 w-5" />
                                Editar Meus Dados Pessoais
                            </Button>
                            <Button
                                onClick={() => alert('Funcionalidade de adicionar usuário em desenvolvimento.')}
                                className="flex-1 bg-yellow-500 text-black hover:bg-yellow-600 py-3 text-base font-semibold transition-all duration-300 cursor-pointer"
                            >
                                <Plus className="mr-2 h-5 w-5" />
                                Adicionar Usuário
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </TabsContent>
        </Tabs>
    );
};

export default ManagerCompanyTabs;
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Settings, User, Building, Bell, CreditCard, History, Loader2, Store, ShoppingBag, Banknote, Globe, Share2, Users } from 'lucide-react';
import { useProfile } from '@/hooks/use-profile';
import { usePageAuth } from '@/hooks/use-page-auth';
import { useManagerCompany } from '@/hooks/use-manager-company';
import { useManagerCompanyContext } from '@/hooks/use-manager-company-context';
import { useCompanyBilling } from '@/hooks/use-company-billing';
import { companyAllowsCreditConsumption } from '@/utils/company-billing-rules';

const MANAGER_PRO_USER_TYPE_ID = 2;

const ManagerSettings: React.FC = () => {
    const navigate = useNavigate();
    const { userId } = usePageAuth();
    const { profile, isLoading: isLoadingProfile } = useProfile(userId);
    const { company } = useManagerCompany(userId);
    const { context: companyContext } = useManagerCompanyContext(userId);
    const { billing } = useCompanyBilling(company?.id);

    const isManagerPro = profile?.tipo_usuario_id === MANAGER_PRO_USER_TYPE_ID;
    const isAdminMaster = profile?.tipo_usuario_id === 1;
    const showCreditOptions = companyAllowsCreditConsumption(billing?.billing_plan);

    let settingsOptions = [
        { 
            icon: <User className="h-6 w-6 text-yellow-500" />, 
            title: "Perfil Individual", 
            description: "Gerencie suas informações pessoais e dados de contato.", 
            path: "/manager/settings/individual-profile" 
        },
        { 
            icon: <Bell className="h-6 w-6 text-yellow-500" />, 
            title: "Notificações", 
            description: "Configure como e quando você deseja receber notificações.", 
            path: "/manager/settings/notifications" 
        },
    ];
    
    // Adiciona opções específicas para Admin Master
    if (isAdminMaster) {
        settingsOptions.push(
            { icon: <Globe className="h-6 w-6 text-yellow-500" />, title: "Site Público", description: "Modo pré-lançamento ou vitrine ao vivo para visitantes.", path: "/admin/settings/public-launch" },
            { icon: <Share2 className="h-6 w-6 text-yellow-500" />, title: "Redes e contato público", description: "Instagram, LinkedIn e telefone exibidos na landing.", path: "/admin/settings/public-social" },
            { icon: <History className="h-6 w-6 text-yellow-500" />, title: "Histórico de Configurações", description: "Visualize todas as alterações feitas nas configurações da sua conta.", path: "/manager/settings/history" },
            { icon: <Settings className="h-6 w-6 text-yellow-500" />, title: "Configurações Avançadas", description: "Mercado Pago da plataforma (mensalidade), sistema e backup.", path: "/manager/settings/advanced" }
        );
    }

    // Perfil da empresa (gestor PRO): inclui aba Ingressos MP para credenciais de venda
    if (isManagerPro) {
        settingsOptions.splice(1, 0, {
            icon: <Building className="h-6 w-6 text-yellow-500" />,
            title: "Perfil da Empresa",
            description: "Dados corporativos, plano, credenciais Mercado Pago de ingressos.",
            path: "/manager/settings/company-profile",
        });
    }

    if (isManagerPro && showCreditOptions) {
        settingsOptions.push(
            {
                icon: <Store className="h-6 w-6 text-yellow-500" />,
                title: "Estabelecimentos (crédito)",
                description: "Cadastre bares e lojas que aceitam crédito EventFest.",
                path: "/manager/credit/establishments",
            },
            {
                icon: <ShoppingBag className="h-6 w-6 text-yellow-500" />,
                title: "PDV — Crédito EventFest",
                description: "Cobrar consumo escaneando o QR da carteira do cliente.",
                path: "/manager/credit/pdv",
            },
        );

        if (companyContext?.isCompanyOwner) {
            settingsOptions.push(
                {
                    icon: <Users className="h-6 w-6 text-yellow-500" />,
                    title: "Operadores PDV",
                    description: "Convide funcionários do balcão (acesso restrito ao PDV e produtos).",
                    path: "/manager/settings/pdv-operators",
                },
                {
                    icon: <Banknote className="h-6 w-6 text-yellow-500" />,
                    title: "Repasses — Crédito",
                    description: "Liquidações liberadas e registro de payout ao gestor.",
                    path: "/manager/credit/settlements",
                },
            );
        }
    }

    if (isLoadingProfile) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando configurações...</p>
            </div>
        );
    }

    if (companyContext?.isPdvOperator) {
        settingsOptions = settingsOptions.filter((opt) =>
            opt.path === '/manager/settings/individual-profile' ||
            opt.path === '/manager/credit/pdv' ||
            opt.path === '/manager/credit/establishments',
        );
    }

    return (
        <div className="max-w-7xl mx-auto">
            <div className="mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 mb-2 flex items-center">
                    <Settings className="h-7 w-7 mr-3" />
                    Configurações
                </h1>
                <p className="text-gray-400 text-sm sm:text-base">Gerencie suas preferências e configurações da conta</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {settingsOptions.map((option, index) => (
                    <Card 
                        key={index}
                        className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10 hover:border-yellow-500/60 transition-all duration-300 cursor-pointer"
                        onClick={() => navigate(option.path)}
                    >
                        <CardHeader>
                            <div className="flex items-center space-x-3 mb-2">
                                {option.icon}
                                <CardTitle className="text-white text-lg font-semibold">{option.title}</CardTitle>
                            </div>
                            <CardDescription className="text-gray-400 text-sm">
                                {option.description}
                            </CardDescription>
                        </CardHeader>
                    </Card>
                ))}
            </div>
        </div>
    );
};

export default ManagerSettings;


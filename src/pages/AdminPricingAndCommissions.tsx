import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Tags } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/hooks/use-profile';
import { showError } from '@/utils/toast';
import { billingBtnBack, billingSpinner } from '@/constants/billing-ui';
import CommissionTiersPanel from '@/components/admin/CommissionTiersPanel';
import MinEventTicketsDefaultSection from '@/components/admin/MinEventTicketsDefaultSection';
import TicketInactivityAdminSection from '@/components/admin/TicketInactivityAdminSection';
import AdminMasterBypassLogSection from '@/components/admin/AdminMasterBypassLogSection';
import ListingMonthlyDefaultFeeSection from '@/components/admin/ListingMonthlyDefaultFeeSection';
import FuturePlanSettingsSection from '@/components/admin/FuturePlanSettingsSection';

const ADMIN_MASTER_USER_TYPE_ID = 1;

type PricingTab = 'tickets' | 'listing' | 'hybrid' | 'consumption';

const TAB_VALUES: PricingTab[] = ['tickets', 'listing', 'hybrid', 'consumption'];

const AdminPricingAndCommissions: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [userId, setUserId] = useState<string | undefined>();

    const tabParam = searchParams.get('tab') as PricingTab | null;
    const activeTab: PricingTab = TAB_VALUES.includes(tabParam as PricingTab)
        ? (tabParam as PricingTab)
        : 'tickets';

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id));
    }, []);

    const { profile, isLoading: loadingProfile } = useProfile(userId);
    const isAdminMaster = profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID;

    useEffect(() => {
        if (!loadingProfile && userId && !isAdminMaster) {
            showError('Acesso negado. Apenas Admin Master.');
            navigate('/manager/dashboard');
        }
    }, [loadingProfile, userId, isAdminMaster, navigate]);

    const setTab = (value: string) => {
        setSearchParams({ tab: value }, { replace: true });
    };

    if (loadingProfile || !userId) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <Loader2 className={`h-10 w-10 animate-spin ${billingSpinner} mx-auto mb-4`} />
                <p className="text-gray-400">Carregando...</p>
            </div>
        );
    }

    if (!isAdminMaster) return null;

    return (
        <div className="max-w-7xl mx-auto">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-serif text-cyan-400 flex items-center gap-3">
                        <Tags className="h-8 w-8" />
                        Preços e comissões
                    </h1>
                    <p className="text-gray-400 text-sm mt-2">
                        Regras e valores padrão por tipo de plano comercial.
                    </p>
                </div>
                <Button type="button" onClick={() => navigate('/admin/dashboard')} className={billingBtnBack}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                </Button>
            </div>

            <Tabs value={activeTab} onValueChange={setTab} className="w-full">
                <TabsList className="bg-black/60 border border-cyan-500/30 p-1 flex flex-wrap h-auto gap-1 mb-6">
                    <TabsTrigger
                        value="tickets"
                        className="data-[state=active]:bg-cyan-400 data-[state=active]:text-black text-gray-300"
                    >
                        Cobrança de ingressos
                    </TabsTrigger>
                    <TabsTrigger
                        value="listing"
                        className="data-[state=active]:bg-cyan-400 data-[state=active]:text-black text-gray-300"
                    >
                        Divulgação
                    </TabsTrigger>
                    <TabsTrigger
                        value="hybrid"
                        className="data-[state=active]:bg-cyan-400 data-[state=active]:text-black text-gray-400"
                    >
                        Ingresso + consumo
                    </TabsTrigger>
                    <TabsTrigger
                        value="consumption"
                        className="data-[state=active]:bg-cyan-400 data-[state=active]:text-black text-gray-400"
                    >
                        Consumo / licença
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="tickets" className="mt-0">
                    <MinEventTicketsDefaultSection enabled={isAdminMaster} />
                    <TicketInactivityAdminSection enabled={isAdminMaster} />
                    <AdminMasterBypassLogSection enabled={isAdminMaster} />
                    <CommissionTiersPanel userId={userId} isAdminMaster={isAdminMaster} />
                </TabsContent>

                <TabsContent value="listing" className="mt-0">
                    <ListingMonthlyDefaultFeeSection enabled={isAdminMaster} />
                </TabsContent>

                <TabsContent value="hybrid" className="mt-0">
                    <FuturePlanSettingsSection kind="hybrid" enabled={isAdminMaster} />
                </TabsContent>

                <TabsContent value="consumption" className="mt-0">
                    <FuturePlanSettingsSection kind="consumption" enabled={isAdminMaster} />
                </TabsContent>
            </Tabs>

        </div>
    );
};

export default AdminPricingAndCommissions;

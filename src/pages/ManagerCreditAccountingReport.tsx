import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FileSpreadsheet, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import CreditAccountingReportPanel from '@/components/CreditAccountingReportPanel';
import { useCreditReportsAccess } from '@/hooks/use-credit-reports-access';

const ManagerCreditAccountingReport: React.FC = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState<string | undefined>();
    const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);

    const access = useCreditReportsAccess(userId);

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id));
    }, []);

    useEffect(() => {
        if (!access.shouldUseAdminAccountingPanel) return;
        let cancelled = false;
        (async () => {
            const { data } = await supabase
                .from('companies')
                .select('id, corporate_name')
                .order('corporate_name');
            if (!cancelled && data) {
                setCompanies(
                    data.map((c) => ({
                        id: c.id as string,
                        name: String(c.corporate_name ?? c.id),
                    })),
                );
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [access.shouldUseAdminAccountingPanel]);

    if (access.isLoading) {
        return (
            <div className="max-w-4xl mx-auto flex justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500" />
            </div>
        );
    }

    if (access.shouldUseAdminAccountingPanel) {
        return (
            <div className="max-w-6xl mx-auto">
                <div className="flex flex-wrap items-center gap-4 mb-6">
                    <Button
                        variant="ghost"
                        className="text-gray-400"
                        onClick={() => navigate('/admin/settings/credit-reports')}
                    >
                        <ArrowLeft className="h-4 w-4 mr-1" /> Créditos Admin
                    </Button>
                    <h1 className="text-2xl font-serif text-yellow-500 flex items-center gap-2">
                        <FileSpreadsheet className="h-6 w-6" />
                        Relatório contábil — Rede EventFest
                    </h1>
                </div>
                <p className="text-gray-400 text-sm mb-4">
                    Visão Admin Master: todas as empresas, recargas, consumos e estornos. Filtro por empresa é opcional.
                </p>
                <CreditAccountingReportPanel mode="admin" companies={companies} />
            </div>
        );
    }

    if (!access.canAccessManagerCreditReports) {
        return (
            <div className="max-w-4xl mx-auto text-center py-16 text-gray-400 px-4">
                <p className="mb-2">
                    {!access.company?.id
                        ? 'Nenhuma empresa vinculada à sua conta de gestor.'
                        : !access.billingReady
                          ? 'Conclua a configuração comercial da empresa em Perfil da Empresa.'
                          : 'O módulo de créditos EventFest não está ativo para o plano da sua empresa.'}
                </p>
                <p className="text-gray-500 text-sm mb-4">
                    Peça ao Admin Master para habilitar o módulo de consumo/créditos ou migrar o plano para híbrido ou consumo.
                </p>
                <Button variant="outline" className="mt-2" onClick={() => navigate('/manager/reports')}>
                    Voltar
                </Button>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto">
            <div className="flex flex-wrap items-center gap-4 mb-6">
                <Button variant="ghost" className="text-gray-400" onClick={() => navigate('/manager/reports')}>
                    <ArrowLeft className="h-4 w-4 mr-1" /> Relatórios
                </Button>
                <h1 className="text-2xl font-serif text-yellow-500 flex items-center gap-2">
                    <FileSpreadsheet className="h-6 w-6" />
                    Relatório contábil — Créditos
                </h1>
            </div>

            <CreditAccountingReportPanel mode="manager" companyId={access.company?.id} />
        </div>
    );
};

export default ManagerCreditAccountingReport;

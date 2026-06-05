import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, Building2, Edit, Loader2, Search } from 'lucide-react';
import { useProfile } from '@/hooks/use-profile';
import { supabase } from '@/integrations/supabase/client';
import { useAdminCompaniesBilling, AdminCompanyBillingRow } from '@/hooks/use-admin-companies-billing';
import { getBillingPlanLabel, isCompanyBillingReady } from '@/constants/billing-plans';
import { companyAllowsTicketSales } from '@/utils/company-billing-rules';
import AdminCompanyBillingEditDialog from '@/components/AdminCompanyBillingEditDialog';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const ADMIN_MASTER_USER_TYPE_ID = 1;

function formatCnpj(value: string | null): string {
    if (!value) return '—';
    const d = value.replace(/\D/g, '');
    if (d.length !== 14) return value;
    return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

const AdminCompaniesBilling: React.FC = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState<string | undefined>();
    const [search, setSearch] = useState('');
    const [editingCompany, setEditingCompany] = useState<AdminCompanyBillingRow | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);

    React.useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id));
    }, []);

    const { profile, isLoading: loadingProfile } = useProfile(userId);
    const isAdminMaster = profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID;

    const { companies, isLoading, isError, invalidate } = useAdminCompaniesBilling(isAdminMaster);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return companies;
        return companies.filter((c) => {
            const hay = [
                c.corporate_name,
                c.trade_name,
                c.cnpj,
                c.email,
                getBillingPlanLabel(c.billing_plan),
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            return hay.includes(q);
        });
    }, [companies, search]);

    const openEdit = (company: AdminCompanyBillingRow) => {
        setEditingCompany(company);
        setDialogOpen(true);
    };

    if (loadingProfile || !userId) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando...</p>
            </div>
        );
    }

    if (!isAdminMaster) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20 text-red-400">
                Acesso restrito ao Admin Master.
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center gap-3">
                        <Building2 className="h-8 w-8" />
                        Planos das Empresas
                    </h1>
                    <p className="text-gray-400 text-sm mt-2">
                        Visualize e altere o plano comercial de cada empresa (inclui downgrade).
                    </p>
                </div>
                <Button
                    variant="outline"
                    onClick={() => navigate('/admin/dashboard')}
                    className="border-yellow-500/30 text-yellow-500"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                </Button>
            </div>

            <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10">
                <CardHeader>
                    <CardTitle className="text-white">Empresas cadastradas</CardTitle>
                    <CardDescription className="text-gray-400">
                        {companies.length} empresa(s) · gestores confirmam plano em Perfil da Empresa
                    </CardDescription>
                    <div className="relative max-w-md pt-2">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 mt-1" />
                        <Input
                            placeholder="Buscar por razão social, CNPJ, e-mail..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-10 bg-black/60 border-yellow-500/30 text-white"
                        />
                    </div>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="py-12 text-center">
                            <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto" />
                        </div>
                    ) : isError ? (
                        <p className="text-red-400 text-center py-8">Erro ao carregar empresas.</p>
                    ) : filtered.length === 0 ? (
                        <p className="text-gray-400 text-center py-8">Nenhuma empresa encontrada.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table className="min-w-[900px]">
                                <TableHeader>
                                    <TableRow className="border-yellow-500/20 hover:bg-transparent">
                                        <TableHead className="text-gray-400">Empresa</TableHead>
                                        <TableHead className="text-gray-400">CNPJ</TableHead>
                                        <TableHead className="text-gray-400">Plano</TableHead>
                                        <TableHead className="text-gray-400">Mín. ingressos</TableHead>
                                        <TableHead className="text-gray-400">Status</TableHead>
                                        <TableHead className="text-gray-400">Aceito em</TableHead>
                                        <TableHead className="text-right text-gray-400">Ações</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filtered.map((company) => {
                                        const ready = isCompanyBillingReady(company);
                                        return (
                                            <TableRow
                                                key={company.id}
                                                className="border-yellow-500/10 hover:bg-yellow-500/5"
                                            >
                                                <TableCell className="text-white">
                                                    <div className="font-medium">
                                                        {company.trade_name ||
                                                            company.corporate_name ||
                                                            '—'}
                                                    </div>
                                                    {company.corporate_name &&
                                                        company.trade_name &&
                                                        company.trade_name !== company.corporate_name && (
                                                            <div className="text-xs text-gray-500">
                                                                {company.corporate_name}
                                                            </div>
                                                        )}
                                                </TableCell>
                                                <TableCell className="text-gray-300 text-sm">
                                                    {formatCnpj(company.cnpj)}
                                                </TableCell>
                                                <TableCell className="text-yellow-500/90 text-sm">
                                                    {getBillingPlanLabel(company.billing_plan)}
                                                </TableCell>
                                                <TableCell className="text-gray-300 text-sm">
                                                    {companyAllowsTicketSales(company.billing_plan) ? (
                                                        <span>
                                                            {company.min_event_tickets}
                                                            {company.min_event_tickets_customized && (
                                                                <span className="ml-1 text-xs text-cyan-400/90">
                                                                    (personalizado)
                                                                </span>
                                                            )}
                                                        </span>
                                                    ) : (
                                                        <span className="text-gray-600">—</span>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    {ready ? (
                                                        <span className="text-xs px-2 py-1 rounded-full bg-green-500/20 text-green-400">
                                                            Confirmado
                                                        </span>
                                                    ) : company.requires_billing_reacceptance ? (
                                                        <span className="text-xs px-2 py-1 rounded-full bg-amber-500/20 text-amber-300">
                                                            Reaceite pendente
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs px-2 py-1 rounded-full bg-gray-500/20 text-gray-400">
                                                            Pendente
                                                        </span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-gray-400 text-sm">
                                                    {company.billing_plan_accepted_at
                                                        ? format(
                                                              new Date(company.billing_plan_accepted_at),
                                                              'dd/MM/yyyy',
                                                              { locale: ptBR },
                                                          )
                                                        : '—'}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="border-yellow-500/30 text-yellow-500"
                                                        onClick={() => openEdit(company)}
                                                    >
                                                        <Edit className="h-4 w-4 mr-1" />
                                                        Alterar plano
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            <AdminCompanyBillingEditDialog
                company={editingCompany}
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                onSaved={invalidate}
            />
        </div>
    );
};

export default AdminCompaniesBilling;

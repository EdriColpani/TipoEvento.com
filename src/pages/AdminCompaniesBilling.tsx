import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, Building2, Edit, Loader2, Search, Store } from 'lucide-react';
import { usePageAuth } from '@/hooks/use-page-auth';
import { useAdminCompaniesBilling, AdminCompanyBillingRow } from '@/hooks/use-admin-companies-billing';
import { getBillingPlanLabel, isCompanyBillingReady } from '@/constants/billing-plans';
import { COMPANY_KIND_LABELS } from '@/constants/company-kind';
import { companyAllowsTicketSales } from '@/utils/company-billing-rules';
import AdminCompanyBillingEditDialog from '@/components/AdminCompanyBillingEditDialog';
import AdminPartnerCompanyActions from '@/components/AdminPartnerCompanyActions';
import { adminBtnOutline, billingBtnSolid } from '@/constants/billing-ui';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';

function formatCnpj(value: string | null): string {
    if (!value) return '—';
    const d = value.replace(/\D/g, '');
    if (d.length !== 14) return value;
    return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function CompanyStatusBadges({
    ready,
    requiresReacceptance,
    inactivityBlocked,
}: {
    ready: boolean;
    requiresReacceptance: boolean;
    inactivityBlocked: boolean;
}) {
    return (
        <div className="flex flex-col items-start gap-1.5">
            {ready ? (
                <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 whitespace-nowrap">
                    Confirmado
                </span>
            ) : requiresReacceptance ? (
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 whitespace-nowrap">
                    Reaceite pendente
                </span>
            ) : (
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-500/20 text-gray-400 whitespace-nowrap">
                    Pendente
                </span>
            )}
            {inactivityBlocked && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300 whitespace-nowrap">
                    Inatividade
                </span>
            )}
        </div>
    );
}

const AdminCompaniesBilling: React.FC = () => {
    const navigate = useNavigate();
    const { userId, authPending } = usePageAuth();
    const [search, setSearch] = useState('');
    const [editingCompany, setEditingCompany] = useState<AdminCompanyBillingRow | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);

    const { companies, isLoading, isError, invalidate } = useAdminCompaniesBilling(
        Boolean(userId),
    );

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return companies;
        return companies.filter((c) => {
            const hay = [
                c.corporate_name,
                c.trade_name,
                c.cnpj,
                c.email,
                c.manager_email,
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

    if (authPending) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Verificando autenticação…</p>
            </div>
        );
    }

    if (!userId) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando...</p>
            </div>
        );
    }

    return (
        <div className="max-w-[1400px] mx-auto px-2 sm:px-0">
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
                <div className="flex flex-col sm:flex-row gap-2">
                    <Button
                        onClick={() => navigate('/admin/settings/partner-companies/create')}
                        className={billingBtnSolid}
                    >
                        <Store className="mr-2 h-4 w-4" />
                        Nova empresa parceira
                    </Button>
                    <Button
                        type="button"
                        onClick={() => navigate('/admin/dashboard')}
                        className={adminBtnOutline}
                    >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Voltar
                    </Button>
                </div>
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
                        <div className="overflow-x-auto -mx-1 px-1">
                            <Table className="min-w-[1180px] table-fixed w-full">
                                <colgroup>
                                    <col className="w-[26%]" />
                                    <col className="w-[13%]" />
                                    <col className="w-[14%]" />
                                    <col className="w-[18%]" />
                                    <col className="w-[7%]" />
                                    <col className="w-[11%]" />
                                    <col className="w-[9%]" />
                                    <col className="w-[12%]" />
                                </colgroup>
                                <TableHeader>
                                    <TableRow className="border-yellow-500/20 hover:bg-transparent">
                                        <TableHead className="text-gray-400 pl-4">Empresa / gestor</TableHead>
                                        <TableHead className="text-gray-400">CNPJ</TableHead>
                                        <TableHead className="text-gray-400">Tipo</TableHead>
                                        <TableHead className="text-gray-400">Plano</TableHead>
                                        <TableHead className="text-gray-400 text-center">Mín.</TableHead>
                                        <TableHead className="text-gray-400">Status</TableHead>
                                        <TableHead className="text-gray-400 whitespace-nowrap">Aceito em</TableHead>
                                        <TableHead className="text-right text-gray-400 pr-4">Ações</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filtered.map((company) => {
                                        const ready = isCompanyBillingReady(company);
                                        return (
                                            <TableRow
                                                key={company.id}
                                                className="border-yellow-500/10 hover:bg-yellow-500/5 align-top"
                                            >
                                                <TableCell className="text-white pl-4 py-4">
                                                    <div className="min-w-0 space-y-1">
                                                        <div
                                                            className="font-medium truncate"
                                                            title={
                                                                company.trade_name ||
                                                                company.corporate_name ||
                                                                undefined
                                                            }
                                                        >
                                                            {company.trade_name ||
                                                                company.corporate_name ||
                                                                '—'}
                                                        </div>
                                                        {company.corporate_name &&
                                                            company.trade_name &&
                                                            company.trade_name !== company.corporate_name && (
                                                                <div
                                                                    className="text-xs text-gray-500 truncate"
                                                                    title={company.corporate_name}
                                                                >
                                                                    {company.corporate_name}
                                                                </div>
                                                            )}
                                                        {company.manager_email ? (
                                                            <a
                                                                href={`mailto:${company.manager_email}`}
                                                                className="block text-xs text-cyan-400/90 hover:text-cyan-300 truncate"
                                                                title={company.manager_email}
                                                            >
                                                                {company.manager_email}
                                                            </a>
                                                        ) : (
                                                            <span className="text-xs text-gray-600">Sem e-mail do gestor</span>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-gray-300 text-sm py-4 whitespace-nowrap">
                                                    {formatCnpj(company.cnpj)}
                                                </TableCell>
                                                <TableCell className="text-gray-300 text-sm py-4 leading-snug">
                                                    {COMPANY_KIND_LABELS[company.company_kind ?? 'organizer'] ??
                                                        'Organizador'}
                                                </TableCell>
                                                <TableCell className="text-yellow-500/90 text-sm py-4 leading-snug">
                                                    {getBillingPlanLabel(company.billing_plan)}
                                                </TableCell>
                                                <TableCell className="text-gray-300 text-sm py-4 text-center whitespace-nowrap">
                                                    {companyAllowsTicketSales(company.billing_plan) ? (
                                                        <span>
                                                            {company.min_event_tickets}
                                                            {company.min_event_tickets_customized && (
                                                                <span
                                                                    className="block text-[10px] text-cyan-400/90 mt-0.5"
                                                                    title="Mínimo personalizado"
                                                                >
                                                                    pers.
                                                                </span>
                                                            )}
                                                        </span>
                                                    ) : (
                                                        <span className="text-gray-600">—</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="py-4">
                                                    <CompanyStatusBadges
                                                        ready={ready}
                                                        requiresReacceptance={company.requires_billing_reacceptance}
                                                        inactivityBlocked={company.ticket_inactivity_blocked}
                                                    />
                                                </TableCell>
                                                <TableCell className="text-gray-400 text-sm py-4 whitespace-nowrap">
                                                    {company.billing_plan_accepted_at
                                                        ? format(
                                                              new Date(company.billing_plan_accepted_at),
                                                              'dd/MM/yyyy',
                                                              { locale: ptBR },
                                                          )
                                                        : '—'}
                                                </TableCell>
                                                <TableCell className="text-right py-4 pr-4">
                                                    <div className="flex flex-col items-end gap-2 min-w-[9.5rem]">
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            className={cn(adminBtnOutline, 'whitespace-nowrap w-full')}
                                                            onClick={() => openEdit(company)}
                                                        >
                                                            <Edit className="h-4 w-4 mr-1 shrink-0" />
                                                            Alterar plano
                                                        </Button>
                                                        {company.company_kind === 'partner' && (
                                                            <AdminPartnerCompanyActions
                                                                company={company}
                                                                onChanged={invalidate}
                                                            />
                                                        )}
                                                    </div>
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

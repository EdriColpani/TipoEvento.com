import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, Loader2, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import EventFormSteps from '@/components/EventFormSteps';
import { usePageAuth } from '@/hooks/use-page-auth';
import { useProfile } from '@/hooks/use-profile';
import { useAdminCompaniesBilling } from '@/hooks/use-admin-companies-billing';
import {
    listCompanyMembers,
    type CompanyMemberRow,
} from '@/utils/company-members';
import { callRpcRest } from '@/utils/supabase-rest-rpc';
import { showError, showSuccess } from '@/utils/toast';
import { adminBtnOutline } from '@/constants/billing-ui';
import { clearManagerCreateEventSession } from '@/utils/manager-create-event-session';

const ADMIN_MASTER_USER_TYPE_ID = 1;

const AdminCreateEventForManager: React.FC = () => {
    const navigate = useNavigate();
    const { userId: authUserId, authPending } = usePageAuth();
    const { profile, isLoading: isLoadingProfile } = useProfile(authUserId);
    const isAdminMaster = profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID;
    const { companies, isLoading: isLoadingCompanies } = useAdminCompaniesBilling(isAdminMaster);

    const [companyId, setCompanyId] = useState('');
    const [ownerUserId, setOwnerUserId] = useState('');
    const [members, setMembers] = useState<CompanyMemberRow[]>([]);
    const [loadingMembers, setLoadingMembers] = useState(false);
    const [validated, setValidated] = useState(false);
    const [validating, setValidating] = useState(false);
    const [targetLabel, setTargetLabel] = useState<{ company: string; manager: string } | null>(
        null,
    );

    const selectedCompany = useMemo(
        () => companies.find((c) => c.id === companyId) ?? null,
        [companies, companyId],
    );

    const selectedMember = useMemo(
        () => members.find((m) => m.user_id === ownerUserId) ?? null,
        [members, ownerUserId],
    );

    useEffect(() => {
        if (!authPending && !isLoadingProfile && profile && !isAdminMaster) {
            showError('Apenas Admin Master pode criar evento para um gestor.');
            navigate('/manager/events', { replace: true });
        }
    }, [authPending, isLoadingProfile, profile, isAdminMaster, navigate]);

    useEffect(() => {
        setOwnerUserId('');
        setMembers([]);
        setValidated(false);
        setTargetLabel(null);

        if (!companyId || !isAdminMaster) return;

        let cancelled = false;
        setLoadingMembers(true);
        void listCompanyMembers(companyId)
            .then((payload) => {
                if (cancelled) return;
                setMembers(payload.members ?? []);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                showError(err instanceof Error ? err.message : 'Falha ao listar gestores da empresa.');
                setMembers([]);
            })
            .finally(() => {
                if (!cancelled) setLoadingMembers(false);
            });

        return () => {
            cancelled = true;
        };
    }, [companyId, isAdminMaster]);

    useEffect(() => {
        setValidated(false);
        setTargetLabel(null);
    }, [ownerUserId]);

    useEffect(() => {
        return () => {
            if (authUserId) clearManagerCreateEventSession(authUserId);
        };
    }, [authUserId]);

    const companyLabel = (row: { trade_name: string | null; corporate_name: string | null }) =>
        row.trade_name?.trim() || row.corporate_name?.trim() || 'Empresa sem nome';

    const memberLabel = (m: CompanyMemberRow) => {
        const name = m.display_name?.trim();
        const email = m.email?.trim();
        const role = m.role ? ` · ${m.role}` : '';
        if (name && email) return `${name} (${email})${role}`;
        return `${name || email || m.user_id}${role}`;
    };

    const handleValidateAndContinue = async () => {
        if (!companyId || !ownerUserId) {
            showError('Selecione a empresa e o gestor.');
            return;
        }
        setValidating(true);
        try {
            const data = await callRpcRest<{
                ok?: boolean;
                company_label?: string;
                owner_display_name?: string | null;
                owner_email?: string | null;
            }>(
                'admin_validate_event_create_for_manager',
                {
                    p_company_id: companyId,
                    p_owner_user_id: ownerUserId,
                },
                12_000,
            );
            setValidated(true);
            setTargetLabel({
                company: data.company_label || companyLabel(selectedCompany!),
                manager:
                    [data.owner_display_name, data.owner_email].filter(Boolean).join(' · ') ||
                    memberLabel(selectedMember!),
            });
            showSuccess('Empresa e gestor validados. Preencha o evento abaixo.');
        } catch (err: unknown) {
            setValidated(false);
            showError(err instanceof Error ? err.message : 'Validação falhou.');
        } finally {
            setValidating(false);
        }
    };

    if (authPending || isLoadingProfile || !isAdminMaster) {
        return (
            <div className="max-w-4xl mx-auto px-4 py-20 text-center">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando...</p>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-0 space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500">
                        Criar evento para gestor
                    </h1>
                    <p className="text-gray-400 text-sm mt-1">
                        Somente Admin Master. O evento nasce ativo e aparece só para o gestor
                        selecionado.
                    </p>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    className={adminBtnOutline}
                    onClick={() => navigate('/manager/events')}
                >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Voltar
                </Button>
            </div>

            <Card className="bg-black/80 border border-yellow-500/30">
                <CardHeader>
                    <CardTitle className="text-white text-lg">1. Empresa e gestor</CardTitle>
                    <CardDescription className="text-gray-400">
                        Escolha a empresa e o usuário gestor que será o dono do evento (
                        <code className="text-yellow-500/90">created_by</code>).
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="admin-event-company" className="text-white">
                            Empresa
                        </Label>
                        <Select
                            value={companyId || undefined}
                            onValueChange={(v) => setCompanyId(v)}
                            disabled={isLoadingCompanies || validated}
                        >
                            <SelectTrigger
                                id="admin-event-company"
                                className="bg-black/60 border-yellow-500/30 text-white"
                            >
                                <SelectValue
                                    placeholder={
                                        isLoadingCompanies
                                            ? 'Carregando empresas...'
                                            : 'Selecione a empresa'
                                    }
                                />
                            </SelectTrigger>
                            <SelectContent className="bg-black border-yellow-500/30 text-white max-h-72">
                                {companies.map((c) => (
                                    <SelectItem key={c.id} value={c.id}>
                                        {companyLabel(c)}
                                        {c.manager_email ? ` — ${c.manager_email}` : ''}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="admin-event-manager" className="text-white">
                            Gestor
                        </Label>
                        <Select
                            value={ownerUserId || undefined}
                            onValueChange={(v) => setOwnerUserId(v)}
                            disabled={!companyId || loadingMembers || validated}
                        >
                            <SelectTrigger
                                id="admin-event-manager"
                                className="bg-black/60 border-yellow-500/30 text-white"
                            >
                                <SelectValue
                                    placeholder={
                                        !companyId
                                            ? 'Selecione a empresa primeiro'
                                            : loadingMembers
                                              ? 'Carregando gestores...'
                                              : members.length === 0
                                                ? 'Nenhum membro vinculado'
                                                : 'Selecione o gestor'
                                    }
                                />
                            </SelectTrigger>
                            <SelectContent className="bg-black border-yellow-500/30 text-white max-h-72">
                                {members.map((m) => (
                                    <SelectItem key={m.user_id} value={m.user_id}>
                                        {memberLabel(m)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {!validated ? (
                        <Button
                            type="button"
                            className="bg-yellow-500 text-black hover:bg-yellow-600"
                            disabled={!companyId || !ownerUserId || validating}
                            onClick={() => void handleValidateAndContinue()}
                        >
                            {validating ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Validando…
                                </>
                            ) : (
                                'Continuar para o formulário'
                            )}
                        </Button>
                    ) : (
                        <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between rounded-xl border border-green-500/30 bg-green-950/30 p-4">
                            <div className="text-sm text-green-100 space-y-1">
                                <p className="flex items-center gap-2">
                                    <Building2 className="h-4 w-4" />
                                    {targetLabel?.company}
                                </p>
                                <p className="flex items-center gap-2">
                                    <UserRound className="h-4 w-4" />
                                    {targetLabel?.manager}
                                </p>
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                className={adminBtnOutline}
                                onClick={() => {
                                    setValidated(false);
                                    setTargetLabel(null);
                                }}
                            >
                                Trocar seleção
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>

            {validated && companyId && ownerUserId ? (
                <div className="space-y-3">
                    <h2 className="text-xl font-serif text-yellow-500">2. Dados do evento</h2>
                    <EventFormSteps
                        userId={authUserId}
                        adminOnBehalfOf={{ companyId, ownerUserId }}
                        onCreateSuccess={() => {
                            navigate('/manager/events');
                        }}
                    />
                </div>
            ) : null}
        </div>
    );
};

export default AdminCreateEventForManager;

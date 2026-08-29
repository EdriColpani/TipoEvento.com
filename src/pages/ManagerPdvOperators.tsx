import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Mail, Trash2, UserPlus, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { usePageAuth } from '@/hooks/use-page-auth';
import { useManagerCompanyContext } from '@/hooks/use-manager-company-context';
import { COMPANY_ROLE_LABELS } from '@/constants/company-roles';
import {
    cancelCompanyMemberInvite,
    listCompanyMembers,
    removeCompanyMember,
    type CompanyMemberRow,
    type PendingCompanyInvite,
} from '@/utils/company-members';
import { invitePdvOperatorWithEmail } from '@/utils/pdv-operator-invite';
import { showError, showSuccess } from '@/utils/toast';
import { useManagerCompany } from '@/hooks/use-manager-company';

const OUTLINE_BTN =
    'bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400';

const ManagerPdvOperators: React.FC = () => {
    const navigate = useNavigate();
    const { userId } = usePageAuth();
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [actionBusyId, setActionBusyId] = useState<string | null>(null);
    const [members, setMembers] = useState<CompanyMemberRow[]>([]);
    const [pendingInvites, setPendingInvites] = useState<PendingCompanyInvite[]>([]);
    const [removeTarget, setRemoveTarget] = useState<CompanyMemberRow | null>(null);
    const [cancelInviteTarget, setCancelInviteTarget] = useState<PendingCompanyInvite | null>(null);

    const { context } = useManagerCompanyContext(userId);
    const { company } = useManagerCompany(userId);

    const reload = async () => {
        if (!context?.companyId) return;
        setLoading(true);
        try {
            const data = await listCompanyMembers(context.companyId);
            setMembers(data.members);
            setPendingInvites(data.pendingInvites);
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Erro ao carregar equipe.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (context?.companyId && context.isCompanyOwner) {
            void reload();
        } else if (context && !context.isCompanyOwner) {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- reload depende do contexto
    }, [context?.companyId, context?.isCompanyOwner]);

    const handleInvite = async () => {
        if (!context?.companyId) return;
        const normalized = email.trim().toLowerCase();
        if (!normalized) {
            showError('Informe o e-mail do operador.');
            return;
        }
        setSaving(true);
        try {
            const companyName = company?.corporate_name?.trim() || 'Empresa';
            const result = await invitePdvOperatorWithEmail({
                companyId: context.companyId,
                operatorEmail: normalized,
                companyName,
            });
            if (!result.ok) {
                showError(result.message);
                return;
            }
            showSuccess(
                result.message ??
                    (result.mode === 'invite'
                        ? 'Convite enviado por e-mail para criar a conta.'
                        : 'E-mail enviado com link de acesso ao PDV.'),
            );
            setEmail('');
            await reload();
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Erro ao convidar operador.');
        } finally {
            setSaving(false);
        }
    };

    const handleConfirmRemove = async () => {
        if (!context?.companyId || !removeTarget) return;
        setActionBusyId(removeTarget.user_id);
        try {
            const result = await removeCompanyMember(context.companyId, removeTarget.user_id);
            showSuccess(result.message ?? 'Acesso de operador removido.');
            setRemoveTarget(null);
            await reload();
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Erro ao remover operador.');
        } finally {
            setActionBusyId(null);
        }
    };

    const handleConfirmCancelInvite = async () => {
        if (!context?.companyId || !cancelInviteTarget) return;
        setActionBusyId(cancelInviteTarget.id);
        try {
            const result = await cancelCompanyMemberInvite(context.companyId, cancelInviteTarget.id);
            showSuccess(result.message ?? 'Convite cancelado.');
            setCancelInviteTarget(null);
            await reload();
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Erro ao cancelar convite.');
        } finally {
            setActionBusyId(null);
        }
    };

    if (!context?.isCompanyOwner) {
        return (
            <div className="max-w-3xl mx-auto text-center py-20 text-gray-400">
                <p>Apenas o proprietário da empresa pode gerenciar operadores PDV.</p>
                <Button
                    variant="outline"
                    className={`mt-4 ${OUTLINE_BTN}`}
                    onClick={() => navigate('/manager/settings')}
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                </Button>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-2xl font-serif text-yellow-500 flex items-center gap-2">
                        <Users className="h-7 w-7" />
                        Operadores PDV
                    </h1>
                    <p className="text-gray-400 text-sm mt-1">
                        Funcionários do balcão com acesso ao PDV e ao catálogo de produtos (sem configurações da
                        empresa). Você pode ter vários operadores e remover o acesso a qualquer momento — a conta
                        deles continua existindo como cliente EventFest.
                    </p>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    className={OUTLINE_BTN}
                    onClick={() => navigate('/manager/settings')}
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                </Button>
            </div>

            <Card className="bg-black border border-yellow-500/30 mb-6">
                <CardHeader>
                    <CardTitle className="text-white text-lg flex items-center gap-2">
                        <Mail className="h-5 w-5 text-yellow-500" />
                        Convidar operador
                    </CardTitle>
                    <CardDescription className="text-gray-400">
                        Informe o e-mail do funcionário para liberar o acesso ao PDV.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-2">
                        <Label htmlFor="operator-email" className="text-gray-300">
                            E-mail do operador
                        </Label>
                        <div className="flex flex-col sm:flex-row gap-3">
                            <Input
                                id="operator-email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="operador@empresa.com"
                                className="bg-black/60 border-yellow-500/30 text-white"
                            />
                            <Button
                                onClick={handleInvite}
                                disabled={saving}
                                className="bg-yellow-500 text-black hover:bg-yellow-600 shrink-0 disabled:opacity-50"
                            >
                                {saving ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <>
                                        <UserPlus className="h-4 w-4 mr-2" />
                                        Convidar
                                    </>
                                )}
                            </Button>
                        </div>
                        <p className="text-xs text-gray-500">
                            O sistema envia um e-mail automático: se a pessoa ainda não tiver conta, o link é para
                            criar senha/cadastro; se já tiver, o link é para entrar. Após o acesso, o menu fica
                            restrito ao PDV.
                        </p>
                    </div>
                </CardContent>
            </Card>

            <Card className="bg-black border border-yellow-500/30">
                <CardHeader>
                    <CardTitle className="text-white text-lg">Equipe vinculada</CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="h-8 w-8 animate-spin text-yellow-500" />
                        </div>
                    ) : (
                        <>
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-yellow-500/20">
                                        <TableHead className="text-gray-400">Nome / e-mail</TableHead>
                                        <TableHead className="text-gray-400">Papel</TableHead>
                                        <TableHead className="text-gray-400 text-right">Ações</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {members.length === 0 ? (
                                        <TableRow className="border-yellow-500/10">
                                            <TableCell colSpan={3} className="text-gray-500 text-center py-6">
                                                Nenhum membro vinculado.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        members.map((m) => {
                                            const canRemove = m.role === 'pdv_operator' && !m.is_primary;
                                            return (
                                                <TableRow key={m.user_id} className="border-yellow-500/10">
                                                    <TableCell className="text-white">
                                                        {m.display_name}
                                                        {m.email ? (
                                                            <span className="block text-xs text-gray-500">
                                                                {m.email}
                                                            </span>
                                                        ) : null}
                                                    </TableCell>
                                                    <TableCell className="text-yellow-500">
                                                        {COMPANY_ROLE_LABELS[m.role] ?? m.role}
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        {canRemove ? (
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                size="sm"
                                                                disabled={actionBusyId === m.user_id}
                                                                className={`${OUTLINE_BTN} disabled:opacity-50`}
                                                                onClick={() => setRemoveTarget(m)}
                                                            >
                                                                {actionBusyId === m.user_id ? (
                                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                                ) : (
                                                                    <>
                                                                        <Trash2 className="h-4 w-4 mr-1" />
                                                                        Remover acesso
                                                                    </>
                                                                )}
                                                            </Button>
                                                        ) : (
                                                            <span className="text-xs text-gray-600">—</span>
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })
                                    )}
                                </TableBody>
                            </Table>

                            {pendingInvites.length > 0 && (
                                <div className="mt-8">
                                    <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
                                        <Mail className="h-4 w-4" />
                                        Convites pendentes
                                    </h3>
                                    <ul className="space-y-2 text-sm text-gray-300">
                                        {pendingInvites.map((inv) => (
                                            <li
                                                key={inv.id}
                                                className="border border-yellow-500/20 rounded-lg px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                                            >
                                                <span>
                                                    {inv.email}{' '}
                                                    <span className="text-gray-500">
                                                        ({COMPANY_ROLE_LABELS[inv.role] ?? inv.role})
                                                    </span>
                                                </span>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={actionBusyId === inv.id}
                                                    className={`${OUTLINE_BTN} disabled:opacity-50 shrink-0`}
                                                    onClick={() => setCancelInviteTarget(inv)}
                                                >
                                                    {actionBusyId === inv.id ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <>
                                                            <X className="h-4 w-4 mr-1" />
                                                            Cancelar convite
                                                        </>
                                                    )}
                                                </Button>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </>
                    )}
                </CardContent>
            </Card>

            <AlertDialog
                open={Boolean(removeTarget)}
                onOpenChange={(open) => {
                    if (!open) setRemoveTarget(null);
                }}
            >
                <AlertDialogContent className="bg-black/95 border border-yellow-500/30 text-white max-w-lg">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-yellow-500">Remover acesso de operador?</AlertDialogTitle>
                        <AlertDialogDescription className="text-gray-400">
                            {removeTarget ? (
                                <>
                                    O usuário{' '}
                                    <strong className="text-gray-200">
                                        {removeTarget.display_name}
                                        {removeTarget.email ? ` (${removeTarget.email})` : ''}
                                    </strong>{' '}
                                    deixará de acessar o PDV desta empresa. A conta continua existindo e pode ser usada
                                    normalmente como cliente EventFest.
                                </>
                            ) : null}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className={OUTLINE_BTN}>Voltar</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-yellow-500 text-black hover:bg-yellow-600"
                            onClick={(e) => {
                                e.preventDefault();
                                void handleConfirmRemove();
                            }}
                        >
                            Remover acesso
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog
                open={Boolean(cancelInviteTarget)}
                onOpenChange={(open) => {
                    if (!open) setCancelInviteTarget(null);
                }}
            >
                <AlertDialogContent className="bg-black/95 border border-yellow-500/30 text-white max-w-lg">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-yellow-500">Cancelar convite?</AlertDialogTitle>
                        <AlertDialogDescription className="text-gray-400">
                            {cancelInviteTarget ? (
                                <>
                                    O e-mail <strong className="text-gray-200">{cancelInviteTarget.email}</strong> não
                                    receberá mais o vínculo automático de operador PDV nesta empresa.
                                </>
                            ) : null}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className={OUTLINE_BTN}>Voltar</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-yellow-500 text-black hover:bg-yellow-600"
                            onClick={(e) => {
                                e.preventDefault();
                                void handleConfirmCancelInvite();
                            }}
                        >
                            Cancelar convite
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default ManagerPdvOperators;

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Mail, UserPlus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useManagerCompanyContext } from '@/hooks/use-manager-company-context';
import { COMPANY_ROLE_LABELS } from '@/constants/company-roles';
import { inviteCompanyMember, listCompanyMembers } from '@/utils/company-members';
import { showError, showSuccess } from '@/utils/toast';

const ManagerPdvOperators: React.FC = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState<string | undefined>();
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [members, setMembers] = useState<Awaited<ReturnType<typeof listCompanyMembers>>['members']>([]);
    const [pendingInvites, setPendingInvites] = useState<
        Awaited<ReturnType<typeof listCompanyMembers>>['pendingInvites']
    >([]);

    const { context } = useManagerCompanyContext(userId);

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setUserId(session?.user?.id);
        });
    }, []);

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
            const result = await inviteCompanyMember(context.companyId, normalized, 'pdv_operator');
            if (result.linked_immediately) {
                showSuccess('Operador vinculado à empresa.');
            } else {
                showSuccess(result.message ?? 'Convite registrado. O operador deve entrar com este e-mail.');
            }
            setEmail('');
            await reload();
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Erro ao convidar operador.');
        } finally {
            setSaving(false);
        }
    };

    if (!context?.isCompanyOwner) {
        return (
            <div className="max-w-3xl mx-auto text-center py-20 text-gray-400">
                <p>Apenas o proprietário da empresa pode gerenciar operadores PDV.</p>
                <Button variant="ghost" className="mt-4 text-yellow-500" onClick={() => navigate('/manager/settings')}>
                    Voltar
                </Button>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto">
            <Button
                variant="ghost"
                className="mb-6 text-gray-400 hover:text-yellow-500"
                onClick={() => navigate('/manager/settings')}
            >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Configurações
            </Button>

            <Card className="bg-black border border-yellow-500/30 mb-6">
                <CardHeader>
                    <CardTitle className="text-yellow-500 flex items-center gap-2">
                        <Users className="h-5 w-5" />
                        Operadores PDV
                    </CardTitle>
                    <CardDescription className="text-gray-400">
                        Funcionários do balcão com acesso ao PDV e ao catálogo de produtos (sem configurações da empresa).
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
                                className="bg-yellow-500 text-black hover:bg-yellow-600 shrink-0"
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
                            Se o e-mail já tiver conta, o acesso é liberado na hora. Caso contrário, peça para criar conta em
                            {' '}
                            <strong>/manager/register/account</strong>
                            {' '}
                            com o mesmo e-mail.
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
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {members.map((m) => (
                                        <TableRow key={m.user_id} className="border-yellow-500/10">
                                            <TableCell className="text-white">
                                                {m.display_name}
                                                {m.email ? (
                                                    <span className="block text-xs text-gray-500">{m.email}</span>
                                                ) : null}
                                            </TableCell>
                                            <TableCell className="text-yellow-500">
                                                {COMPANY_ROLE_LABELS[m.role] ?? m.role}
                                            </TableCell>
                                        </TableRow>
                                    ))}
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
                                            <li key={inv.id} className="border border-yellow-500/20 rounded-lg px-3 py-2">
                                                {inv.email}
                                                {' '}
                                                <span className="text-gray-500">
                                                    ({COMPANY_ROLE_LABELS[inv.role] ?? inv.role})
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

export default ManagerPdvOperators;

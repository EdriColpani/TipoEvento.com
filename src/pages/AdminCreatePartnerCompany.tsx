import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, Loader2, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/hooks/use-profile';
import { adminCreatePartnerCompany } from '@/utils/company-members';
import { sendPartnerOwnerInviteEmail } from '@/utils/partner-owner-invite';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { RpcTimeoutError } from '@/utils/supabase-rpc';
import { adminBtnOutline } from '@/constants/billing-ui';

const ADMIN_MASTER_USER_TYPE_ID = 1;

const AdminCreatePartnerCompany: React.FC = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState<string | undefined>();
    const [saving, setSaving] = useState(false);
    const [cnpj, setCnpj] = useState('');
    const [corporateName, setCorporateName] = useState('');
    const [tradeName, setTradeName] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [ownerEmail, setOwnerEmail] = useState('');

    const { profile, isLoading: loadingProfile } = useProfile(userId);
    const isAdminMaster = profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID;

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setUserId(session?.user?.id);
        });
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!corporateName.trim() || !cnpj.trim()) {
            showError('Informe CNPJ e razão social.');
            return;
        }
        const resolvedOwnerEmail = (ownerEmail.trim() || email.trim()).toLowerCase();
        if (!resolvedOwnerEmail || !resolvedOwnerEmail.includes('@')) {
            showError('Informe o e-mail do gestor (dono). Sem ele não é possível enviar o convite para criar a senha.');
            return;
        }
        setSaving(true);
        const loadingToast = showLoading('Criando empresa parceira e enviando convite...');
        try {
            const result = await adminCreatePartnerCompany({
                cnpj,
                corporateName: corporateName.trim(),
                tradeName: tradeName.trim() || undefined,
                email: email.trim() || undefined,
                phone: phone.trim() || undefined,
                ownerEmail: resolvedOwnerEmail,
            });

            const inviteEmail = await sendPartnerOwnerInviteEmail({
                companyId: result.company_id,
                ownerEmail: resolvedOwnerEmail,
                companyName: tradeName.trim() || corporateName.trim(),
            });

            if (!inviteEmail.ok) {
                throw new Error(
                    inviteEmail.message ||
                        'Empresa criada, mas o e-mail de convite não foi enviado. O gestor não conseguirá criar a senha.',
                );
            }

            if (result.owner_invite?.linked_immediately) {
                showSuccess(
                    inviteEmail.message ||
                        'Empresa parceira criada. E-mail enviado ao gestor (conta já existente — deve entrar pelo link).',
                );
            } else {
                showSuccess(
                    inviteEmail.message ||
                        'Empresa parceira criada. E-mail enviado ao gestor para criar a senha e acessar.',
                );
            }

            navigate('/admin/settings/companies-billing');
        } catch (err: unknown) {
            if (err instanceof RpcTimeoutError) {
                showError('Tempo esgotado. Rode supabase/scripts/FIX_PARCEIRO_AGORA.sql no Supabase e tente de novo.');
            } else {
                showError(err instanceof Error ? err.message : 'Erro ao criar empresa parceira.');
            }
        } finally {
            dismissToast(loadingToast);
            setSaving(false);
        }
    };

    if (loadingProfile || !userId) {
        return (
            <div className="max-w-3xl mx-auto text-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando...</p>
            </div>
        );
    }

    if (!isAdminMaster) {
        return (
            <div className="max-w-3xl mx-auto text-center py-20 text-red-400">
                Acesso restrito ao Admin Master.
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto">
            <div className="flex items-center justify-between mb-8 gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center gap-3">
                        <Store className="h-8 w-8" />
                        Nova empresa parceira
                    </h1>
                    <p className="text-gray-400 text-sm mt-2">
                        Plano Consumo / licença, tipo parceiro e convite ao gestor.
                    </p>
                </div>
                <Button
                    type="button"
                    onClick={() => navigate('/admin/settings/companies-billing')}
                    className={adminBtnOutline}
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                </Button>
            </div>

            <Card className="bg-black border border-yellow-500/30">
                <CardHeader>
                    <CardTitle className="text-white flex items-center gap-2">
                        <Building2 className="h-5 w-5 text-yellow-500" />
                        Dados da empresa
                    </CardTitle>
                    <CardDescription className="text-gray-400">
                        Endereço completo pode ser preenchido depois pelo gestor em Perfil da Empresa.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid gap-2">
                            <Label className="text-gray-300">CNPJ *</Label>
                            <Input
                                value={cnpj}
                                onChange={(e) => setCnpj(e.target.value)}
                                className="bg-black/60 border-yellow-500/30 text-white"
                                placeholder="00.000.000/0000-00"
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label className="text-gray-300">Razão social *</Label>
                            <Input
                                value={corporateName}
                                onChange={(e) => setCorporateName(e.target.value)}
                                className="bg-black/60 border-yellow-500/30 text-white"
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label className="text-gray-300">Nome fantasia</Label>
                            <Input
                                value={tradeName}
                                onChange={(e) => setTradeName(e.target.value)}
                                className="bg-black/60 border-yellow-500/30 text-white"
                            />
                        </div>
                        <div className="grid sm:grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label className="text-gray-300">E-mail corporativo</Label>
                                <Input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="bg-black/60 border-yellow-500/30 text-white"
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label className="text-gray-300">Telefone</Label>
                                <Input
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                    className="bg-black/60 border-yellow-500/30 text-white"
                                />
                            </div>
                        </div>
                        <div className="grid gap-2 border-t border-yellow-500/20 pt-4">
                            <Label className="text-gray-300">E-mail do gestor (dono) *</Label>
                            <Input
                                type="email"
                                required
                                value={ownerEmail}
                                onChange={(e) => setOwnerEmail(e.target.value)}
                                placeholder="Se vazio, usa o e-mail corporativo"
                                className="bg-black/60 border-yellow-500/30 text-white"
                            />
                            <p className="text-xs text-gray-500">
                                Obrigatório. Enviaremos um e-mail com link para o gestor criar a senha e acessar o painel.
                            </p>
                        </div>
                        <Button
                            type="submit"
                            disabled={saving}
                            className="w-full bg-yellow-500 text-black hover:bg-yellow-600 mt-4"
                        >
                            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Criar empresa parceira'}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
};

export default AdminCreatePartnerCompany;

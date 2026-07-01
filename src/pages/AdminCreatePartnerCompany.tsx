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
import { showError, showSuccess } from '@/utils/toast';

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
        setSaving(true);
        try {
            const result = await adminCreatePartnerCompany({
                cnpj,
                corporateName: corporateName.trim(),
                tradeName: tradeName.trim() || undefined,
                email: email.trim() || undefined,
                phone: phone.trim() || undefined,
                ownerEmail: ownerEmail.trim() || email.trim() || undefined,
            });

            if (result.owner_invite?.linked_immediately) {
                showSuccess('Empresa parceira criada e gestor vinculado.');
            } else if (result.owner_invite?.message) {
                showSuccess(`Empresa parceira criada. ${result.owner_invite.message}`);
            } else {
                showSuccess('Empresa parceira criada. O gestor deve aceitar o plano no primeiro acesso.');
            }

            navigate('/admin/settings/companies-billing');
        } catch (err: unknown) {
            showError(err instanceof Error ? err.message : 'Erro ao criar empresa parceira.');
        } finally {
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
                    variant="outline"
                    onClick={() => navigate('/admin/settings/companies-billing')}
                    className="border-yellow-500/30 text-yellow-500"
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
                            <Label className="text-gray-300">E-mail do gestor (dono)</Label>
                            <Input
                                type="email"
                                value={ownerEmail}
                                onChange={(e) => setOwnerEmail(e.target.value)}
                                placeholder="Se vazio, usa o e-mail corporativo"
                                className="bg-black/60 border-yellow-500/30 text-white"
                            />
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

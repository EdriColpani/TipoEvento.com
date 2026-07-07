import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, Loader2, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePageAuth } from '@/hooks/use-page-auth';
import { adminCreatePartnerCompany } from '@/utils/company-members';
import { sendPartnerOwnerInviteEmail } from '@/utils/partner-owner-invite';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { adminBtnOutline } from '@/constants/billing-ui';

const UF_OPTIONS = [
    'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
    'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

const AdminCreatePartnerCompany: React.FC = () => {
    const navigate = useNavigate();
    const { authPending, sessionReady } = usePageAuth();
    const [saving, setSaving] = useState(false);
    const [cepLoading, setCepLoading] = useState(false);
    const [cnpj, setCnpj] = useState('');
    const [corporateName, setCorporateName] = useState('');
    const [tradeName, setTradeName] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [ownerEmail, setOwnerEmail] = useState('');
    const [cep, setCep] = useState('');
    const [street, setStreet] = useState('');
    const [number, setNumber] = useState('');
    const [complement, setComplement] = useState('');
    const [neighborhood, setNeighborhood] = useState('');
    const [city, setCity] = useState('');
    const [state, setState] = useState('');

    const fetchAddressByCep = async (rawCep: string) => {
        const clean = rawCep.replace(/\D/g, '');
        if (clean.length !== 8) return;
        setCepLoading(true);
        try {
            const response = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
            const data = await response.json();
            if (data.erro) {
                showError('CEP não encontrado.');
                return;
            }
            setStreet(data.logradouro || '');
            setNeighborhood(data.bairro || '');
            setCity(data.localidade || '');
            setState(data.uf || '');
        } catch {
            showError('Não foi possível buscar o CEP.');
        } finally {
            setCepLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!corporateName.trim() || !cnpj.trim()) {
            showError('Informe CNPJ e razão social.');
            return;
        }
        const resolvedOwnerEmail = (ownerEmail.trim() || email.trim()).toLowerCase();
        if (!resolvedOwnerEmail || !resolvedOwnerEmail.includes('@')) {
            showError('Informe o e-mail do gestor (dono).');
            return;
        }
        if (cep.replace(/\D/g, '').length !== 8) {
            showError('Informe o CEP (8 dígitos).');
            return;
        }
        if (!street.trim() || !number.trim() || !neighborhood.trim() || !city.trim() || state.trim().length !== 2) {
            showError('Preencha o endereço completo (rua, número, bairro, cidade e UF).');
            return;
        }

        setSaving(true);
        let loadingToast = showLoading('Criando empresa parceira...');
        try {
            const result = await adminCreatePartnerCompany({
                cnpj,
                corporateName: corporateName.trim(),
                tradeName: tradeName.trim() || undefined,
                email: email.trim() || undefined,
                phone: phone.trim() || undefined,
                ownerEmail: resolvedOwnerEmail,
                address: {
                    cep,
                    street: street.trim(),
                    number: number.trim(),
                    complement: complement.trim() || undefined,
                    neighborhood: neighborhood.trim(),
                    city: city.trim(),
                    state: state.trim().toUpperCase(),
                },
            });

            dismissToast(loadingToast);
            loadingToast = showLoading('Enviando e-mail de convite ao gestor...');

            let inviteEmail: Awaited<ReturnType<typeof sendPartnerOwnerInviteEmail>>;
            try {
                inviteEmail = await sendPartnerOwnerInviteEmail({
                    companyId: result.company_id,
                    ownerEmail: resolvedOwnerEmail,
                    companyName: tradeName.trim() || corporateName.trim(),
                });
            } catch (inviteErr) {
                console.warn('[AdminCreatePartnerCompany] invite email:', inviteErr);
                inviteEmail = {
                    ok: false,
                    message:
                        'Empresa criada. Use "Enviar convite" na lista de empresas para o gestor criar a senha.',
                };
            }

            if (!inviteEmail.ok) {
                showSuccess(
                    `Empresa parceira criada. ${inviteEmail.message}`,
                );
                navigate('/admin/settings/companies-billing');
                return;
            }

            showSuccess(
                inviteEmail.message ||
                    'Empresa parceira criada. E-mail enviado ao gestor para criar a senha e acessar.',
            );
            navigate('/admin/settings/companies-billing');
        } catch (err: unknown) {
            showError(err instanceof Error ? err.message : 'Erro ao criar empresa parceira.');
        } finally {
            dismissToast(loadingToast);
            setSaving(false);
        }
    };

    if (authPending || !sessionReady) {
        return (
            <div className="max-w-3xl mx-auto text-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Verificando autenticação…</p>
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
                        CNPJ, contato e endereço são obrigatórios no cadastro da empresa parceira.
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
                                required
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label className="text-gray-300">Razão social *</Label>
                            <Input
                                value={corporateName}
                                onChange={(e) => setCorporateName(e.target.value)}
                                className="bg-black/60 border-yellow-500/30 text-white"
                                required
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

                        <div className="border-t border-yellow-500/20 pt-4 space-y-4">
                            <p className="text-sm text-yellow-500/90 font-medium">Endereço *</p>
                            <div className="grid sm:grid-cols-3 gap-4">
                                <div className="grid gap-2 sm:col-span-1">
                                    <Label className="text-gray-300">CEP *</Label>
                                    <div className="flex gap-2">
                                        <Input
                                            value={cep}
                                            onChange={(e) => setCep(e.target.value)}
                                            onBlur={() => void fetchAddressByCep(cep)}
                                            className="bg-black/60 border-yellow-500/30 text-white"
                                            placeholder="00000-000"
                                            required
                                        />
                                        {cepLoading ? (
                                            <Loader2 className="h-5 w-5 animate-spin text-yellow-500 self-center shrink-0" />
                                        ) : null}
                                    </div>
                                </div>
                                <div className="grid gap-2 sm:col-span-2">
                                    <Label className="text-gray-300">Logradouro *</Label>
                                    <Input
                                        value={street}
                                        onChange={(e) => setStreet(e.target.value)}
                                        className="bg-black/60 border-yellow-500/30 text-white"
                                        required
                                    />
                                </div>
                            </div>
                            <div className="grid sm:grid-cols-3 gap-4">
                                <div className="grid gap-2">
                                    <Label className="text-gray-300">Número *</Label>
                                    <Input
                                        value={number}
                                        onChange={(e) => setNumber(e.target.value)}
                                        className="bg-black/60 border-yellow-500/30 text-white"
                                        required
                                    />
                                </div>
                                <div className="grid gap-2 sm:col-span-2">
                                    <Label className="text-gray-300">Complemento</Label>
                                    <Input
                                        value={complement}
                                        onChange={(e) => setComplement(e.target.value)}
                                        className="bg-black/60 border-yellow-500/30 text-white"
                                    />
                                </div>
                            </div>
                            <div className="grid sm:grid-cols-3 gap-4">
                                <div className="grid gap-2">
                                    <Label className="text-gray-300">Bairro *</Label>
                                    <Input
                                        value={neighborhood}
                                        onChange={(e) => setNeighborhood(e.target.value)}
                                        className="bg-black/60 border-yellow-500/30 text-white"
                                        required
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label className="text-gray-300">Cidade *</Label>
                                    <Input
                                        value={city}
                                        onChange={(e) => setCity(e.target.value)}
                                        className="bg-black/60 border-yellow-500/30 text-white"
                                        required
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label className="text-gray-300">UF *</Label>
                                    <select
                                        value={state}
                                        onChange={(e) => setState(e.target.value)}
                                        className="h-10 w-full rounded-md bg-black/60 border border-yellow-500/30 text-white px-3 text-sm"
                                        required
                                    >
                                        <option value="">UF</option>
                                        {UF_OPTIONS.map((uf) => (
                                            <option key={uf} value={uf}>
                                                {uf}
                                            </option>
                                        ))}
                                    </select>
                                </div>
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
                                Enviaremos um e-mail com link para o gestor criar a senha e acessar o painel.
                            </p>
                        </div>
                        <Button
                            type="submit"
                            disabled={saving}
                            className="w-full bg-yellow-500 text-black hover:bg-yellow-600 mt-4 disabled:opacity-50"
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

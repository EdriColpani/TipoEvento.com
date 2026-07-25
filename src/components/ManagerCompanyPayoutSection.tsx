"use client";

import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Landmark, Loader2, Wallet } from 'lucide-react';
import ManagerTicketMpCredentialsSection from '@/components/ManagerTicketMpCredentialsSection';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCompanyPayoutProfile } from '@/hooks/use-company-payout-profile';
import {
  upsertCompanyPayoutProfile,
  type PixKeyType,
  type PayoutMode,
} from '@/utils/company-payout-api';
import { showError, showSuccess } from '@/utils/toast';

type ManagerCompanyPayoutSectionProps = {
  companyId: string;
  forceBankOnly?: boolean;
};

const emptyBank = {
  bankCode: '',
  bankName: '',
  agency: '',
  accountNumber: '',
  accountDigit: '',
  accountType: '' as '' | 'checking' | 'savings',
  holderName: '',
  holderDocument: '',
  pixKey: '',
  pixKeyType: '' as '' | PixKeyType,
};

const ManagerCompanyPayoutSection: React.FC<ManagerCompanyPayoutSectionProps> = ({
  companyId,
  forceBankOnly = false,
}) => {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useCompanyPayoutProfile(companyId);
  const [mode, setMode] = useState<PayoutMode>(forceBankOnly ? 'bank_transfer' : 'mercado_pago');
  const [bank, setBank] = useState(emptyBank);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    if (forceBankOnly) {
      setMode('bank_transfer');
    } else if (data.payout_mode) {
      setMode(data.payout_mode);
    } else if (data.mp_configured) {
      setMode('mercado_pago');
    }
    const b = data.bank;
    if (b) {
      setBank({
        bankCode: b.bank_code ?? '',
        bankName: b.bank_name ?? '',
        agency: b.agency ?? '',
        accountNumber: b.account_number ?? '',
        accountDigit: b.account_digit ?? '',
        accountType: (b.account_type as 'checking' | 'savings' | '') || '',
        holderName: b.holder_name ?? '',
        holderDocument: b.holder_document ?? '',
        pixKey: b.pix_key ?? '',
        pixKeyType: (b.pix_key_type as PixKeyType | '') || '',
      });
    }
  }, [data, forceBankOnly]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await upsertCompanyPayoutProfile({
        companyId,
        payoutMode: mode,
        bankCode: bank.bankCode,
        bankName: bank.bankName,
        agency: bank.agency,
        accountNumber: bank.accountNumber,
        accountDigit: bank.accountDigit,
        accountType: bank.accountType,
        holderName: bank.holderName,
        holderDocument: bank.holderDocument,
        pixKey: bank.pixKey,
        pixKeyType: bank.pixKeyType,
      });
      showSuccess('Recebimento salvo com sucesso.');
      await queryClient.invalidateQueries({ queryKey: ['companyPayoutProfile', companyId] });
      await queryClient.invalidateQueries({ queryKey: ['companyPayoutSetupValid', companyId] });
      await refetch();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Não foi possível salvar o recebimento.');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-yellow-500">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        Carregando recebimento…
      </div>
    );
  }

  if (isError) {
    return (
      <Alert className="bg-red-950/40 border-red-500/40 text-red-50">
        <AlertTitle>Erro ao carregar</AlertTitle>
        <AlertDescription>
          Não foi possível carregar o perfil de recebimento.{' '}
          <Button
            type="button"
            variant="outline"
            className="ml-2 bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
            onClick={() => refetch()}
          >
            Tentar de novo
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {!data?.setup_valid && (
        <Alert className="bg-amber-950/60 border-amber-500/40 text-amber-50">
          <AlertTitle>Recebimento obrigatório</AlertTitle>
          <AlertDescription>
            Sem Mercado Pago conectado ou conta bancária/PIX completa, não é possível criar eventos
            pagos. Escolha um modo abaixo e salve.
          </AlertDescription>
        </Alert>
      )}

      <Card className="bg-black/80 border border-yellow-500/30">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Wallet className="h-5 w-5 text-yellow-500" />
            Como você quer receber?
          </CardTitle>
          <CardDescription className="text-gray-400">
            {forceBankOnly
              ? 'Empresa parceira recebe via PIX/TED (D+1). Informe os dados bancários.'
              : 'Mercado Pago: split no ato. Conta bancária: EventFest cobra e repassa em D+1.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!forceBankOnly && (
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setMode('mercado_pago')}
                className={`rounded-xl border p-4 text-left transition ${
                  mode === 'mercado_pago'
                    ? 'border-yellow-500 bg-yellow-500/15 text-yellow-400'
                    : 'border-yellow-500/20 bg-black/40 text-gray-300 hover:border-yellow-500/40'
                }`}
              >
                <div className="font-semibold flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Mercado Pago
                </div>
                <p className="text-xs mt-1 opacity-80">
                  Cliente paga na sua conta MP; comissão EventFest no ato.
                </p>
              </button>
              <button
                type="button"
                onClick={() => setMode('bank_transfer')}
                className={`rounded-xl border p-4 text-left transition ${
                  mode === 'bank_transfer'
                    ? 'border-yellow-500 bg-yellow-500/15 text-yellow-400'
                    : 'border-yellow-500/20 bg-black/40 text-gray-300 hover:border-yellow-500/40'
                }`}
              >
                <div className="font-semibold flex items-center gap-2">
                  <Landmark className="h-4 w-4" />
                  Conta bancária / PIX
                </div>
                <p className="text-xs mt-1 opacity-80">
                  EventFest cobra e gera lançamento D+1 para repasse manual.
                </p>
              </button>
            </div>
          )}

          {mode === 'mercado_pago' && !forceBankOnly && (
            <div className="space-y-4">
              <ManagerTicketMpCredentialsSection companyId={companyId} />
              <div className="flex justify-end">
                <Button
                  type="button"
                  disabled={saving || !data?.mp_configured}
                  onClick={handleSave}
                  className="bg-yellow-500 text-black hover:bg-yellow-600 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Confirmar modo Mercado Pago
                </Button>
              </div>
              {!data?.mp_configured && (
                <p className="text-sm text-amber-200">
                  Conecte o Mercado Pago acima e depois confirme o modo.
                </p>
              )}
            </div>
          )}

          {(mode === 'bank_transfer' || forceBankOnly) && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-gray-300">Código do banco *</Label>
                  <Input
                    value={bank.bankCode}
                    onChange={(e) => setBank((s) => ({ ...s, bankCode: e.target.value }))}
                    className="bg-black/60 border-yellow-500/30 text-white"
                    placeholder="Ex.: 001"
                  />
                </div>
                <div>
                  <Label className="text-gray-300">Nome do banco *</Label>
                  <Input
                    value={bank.bankName}
                    onChange={(e) => setBank((s) => ({ ...s, bankName: e.target.value }))}
                    className="bg-black/60 border-yellow-500/30 text-white"
                    placeholder="Ex.: Banco do Brasil"
                  />
                </div>
                <div>
                  <Label className="text-gray-300">Agência *</Label>
                  <Input
                    value={bank.agency}
                    onChange={(e) => setBank((s) => ({ ...s, agency: e.target.value }))}
                    className="bg-black/60 border-yellow-500/30 text-white"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <Label className="text-gray-300">Conta *</Label>
                    <Input
                      value={bank.accountNumber}
                      onChange={(e) => setBank((s) => ({ ...s, accountNumber: e.target.value }))}
                      className="bg-black/60 border-yellow-500/30 text-white"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300">Dígito</Label>
                    <Input
                      value={bank.accountDigit}
                      onChange={(e) => setBank((s) => ({ ...s, accountDigit: e.target.value }))}
                      className="bg-black/60 border-yellow-500/30 text-white"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-gray-300">Tipo de conta</Label>
                  <Select
                    value={bank.accountType || undefined}
                    onValueChange={(v) =>
                      setBank((s) => ({ ...s, accountType: v as 'checking' | 'savings' }))
                    }
                  >
                    <SelectTrigger className="bg-black/60 border-yellow-500/30 text-white">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="checking">Corrente</SelectItem>
                      <SelectItem value="savings">Poupança</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-gray-300">Titular *</Label>
                  <Input
                    value={bank.holderName}
                    onChange={(e) => setBank((s) => ({ ...s, holderName: e.target.value }))}
                    className="bg-black/60 border-yellow-500/30 text-white"
                  />
                </div>
                <div>
                  <Label className="text-gray-300">CPF/CNPJ do titular *</Label>
                  <Input
                    value={bank.holderDocument}
                    onChange={(e) => setBank((s) => ({ ...s, holderDocument: e.target.value }))}
                    className="bg-black/60 border-yellow-500/30 text-white"
                  />
                </div>
                <div>
                  <Label className="text-gray-300">Tipo da chave PIX *</Label>
                  <Select
                    value={bank.pixKeyType || undefined}
                    onValueChange={(v) =>
                      setBank((s) => ({ ...s, pixKeyType: v as PixKeyType }))
                    }
                  >
                    <SelectTrigger className="bg-black/60 border-yellow-500/30 text-white">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cpf">CPF</SelectItem>
                      <SelectItem value="cnpj">CNPJ</SelectItem>
                      <SelectItem value="email">E-mail</SelectItem>
                      <SelectItem value="phone">Telefone</SelectItem>
                      <SelectItem value="random">Aleatória</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-gray-300">Chave PIX *</Label>
                  <Input
                    value={bank.pixKey}
                    onChange={(e) => setBank((s) => ({ ...s, pixKey: e.target.value }))}
                    className="bg-black/60 border-yellow-500/30 text-white"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  disabled={saving}
                  onClick={handleSave}
                  className="bg-yellow-500 text-black hover:bg-yellow-600 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Salvar conta bancária / PIX
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ManagerCompanyPayoutSection;

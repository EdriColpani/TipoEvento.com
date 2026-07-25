import { callRpcRest } from '@/utils/supabase-rest-rpc';

export type PayoutMode = 'mercado_pago' | 'bank_transfer';

export type PixKeyType = 'cpf' | 'cnpj' | 'email' | 'phone' | 'random';

export type CompanyPayoutBank = {
  bank_code: string | null;
  bank_name: string | null;
  agency: string | null;
  account_number: string | null;
  account_digit: string | null;
  account_type: 'checking' | 'savings' | null;
  holder_name: string | null;
  holder_document: string | null;
  pix_key: string | null;
  pix_key_type: PixKeyType | null;
};

export type CompanyPayoutProfile = {
  company_id: string;
  exists: boolean;
  payout_mode: PayoutMode | null;
  mp_configured: boolean;
  setup_valid: boolean;
  updated_at?: string | null;
  bank: CompanyPayoutBank | null;
};

export type UpsertCompanyPayoutInput = {
  companyId: string;
  payoutMode: PayoutMode;
  bankCode?: string;
  bankName?: string;
  agency?: string;
  accountNumber?: string;
  accountDigit?: string;
  accountType?: 'checking' | 'savings' | '';
  holderName?: string;
  holderDocument?: string;
  pixKey?: string;
  pixKeyType?: PixKeyType | '';
};

export async function fetchCompanyPayoutProfile(companyId: string): Promise<CompanyPayoutProfile> {
  return callRpcRest<CompanyPayoutProfile>(
    'get_company_payout_profile',
    { p_company_id: companyId },
    12_000,
  );
}

export async function upsertCompanyPayoutProfile(
  input: UpsertCompanyPayoutInput,
): Promise<CompanyPayoutProfile> {
  return callRpcRest<CompanyPayoutProfile>(
    'upsert_company_payout_profile',
    {
      p_company_id: input.companyId,
      p_payout_mode: input.payoutMode,
      p_bank_code: input.bankCode || null,
      p_bank_name: input.bankName || null,
      p_agency: input.agency || null,
      p_account_number: input.accountNumber || null,
      p_account_digit: input.accountDigit || null,
      p_account_type: input.accountType || null,
      p_holder_name: input.holderName || null,
      p_holder_document: input.holderDocument || null,
      p_pix_key: input.pixKey || null,
      p_pix_key_type: input.pixKeyType || null,
    },
    15_000,
  );
}

export async function companyHasValidPayoutSetup(companyId: string): Promise<boolean> {
  return callRpcRest<boolean>('company_has_valid_payout_setup', { p_company_id: companyId }, 10_000);
}

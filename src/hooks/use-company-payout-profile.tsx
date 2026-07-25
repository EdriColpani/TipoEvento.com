import { useQuery } from '@tanstack/react-query';
import {
  companyHasValidPayoutSetup,
  fetchCompanyPayoutProfile,
  type CompanyPayoutProfile,
} from '@/utils/company-payout-api';

export function useCompanyPayoutProfile(companyId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['companyPayoutProfile', companyId],
    queryFn: () => fetchCompanyPayoutProfile(companyId!),
    enabled: Boolean(companyId) && enabled,
    staleTime: 15_000,
  });
}

export function useCompanyPayoutSetupValid(companyId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['companyPayoutSetupValid', companyId],
    queryFn: () => companyHasValidPayoutSetup(companyId!),
    enabled: Boolean(companyId) && enabled,
    staleTime: 15_000,
  });
}

export type { CompanyPayoutProfile };

import { useQuery } from '@tanstack/react-query';
import {
    fetchManagerRegistrationGateStatus,
    type ManagerRegistrationGateStatus,
} from '@/utils/manager-registration-contract-gate';

const EMPTY_STATUS: ManagerRegistrationGateStatus = {
    companyId: null,
    registrationSatisfied: true,
    pendingContractSigning: false,
};

export function useManagerRegistrationContractGate(userId?: string | null, enabled = true) {
    return useQuery({
        queryKey: ['managerRegistrationContractGate', userId],
        queryFn: () => fetchManagerRegistrationGateStatus(userId!),
        enabled: Boolean(userId) && enabled,
        staleTime: 10_000,
        retry: 1,
    });
}

export function useManagerRegistrationContractGateStatus(
    userId?: string | null,
    enabled = true,
) {
    const query = useManagerRegistrationContractGate(userId, enabled);
    return {
        ...query,
        status: query.data ?? EMPTY_STATUS,
        pendingContractSigning: query.data?.pendingContractSigning ?? false,
    };
}

/** Página do gestor para pagar licença mensal do plano consumo/licença. */
export const MANAGER_CONSUMPTION_LICENSE_PATH = '/manager/reports/consumption-license';

const REPORTS_PREFIX = '/manager/reports';

/** Rotas permitidas com licença mensal pendente (equivalente à vitrine vencida). */
export function isManagerPathAllowedWhenConsumptionLicenseUnpaid(pathname: string): boolean {
    if (pathname.startsWith(REPORTS_PREFIX)) return true;
    if (pathname.startsWith('/manager/settings/company-profile')) return true;
    return false;
}

export function consumptionLicenseBlocksOperations(
    status: { requires_license?: boolean; blocks_consumption?: boolean } | null | undefined,
): boolean {
    if (!status?.requires_license) return false;
    return status.blocks_consumption === true;
}

export function consumptionLicenseNeedsBanner(
    status: { requires_license?: boolean; is_paid?: boolean; blocks_consumption?: boolean } | null | undefined,
): boolean {
    if (!status?.requires_license) return false;
    return status.blocks_consumption === true;
}

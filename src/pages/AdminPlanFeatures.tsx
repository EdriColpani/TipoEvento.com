import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Save, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePublicSiteAuth } from '@/contexts/PublicLaunchModeContext';
import { usePageAuth } from '@/hooks/use-page-auth';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import {
    BILLING_PLAN_COLUMNS,
    PLAN_FEATURE_DEFINITIONS,
    type PlanFeatureKey,
} from '@/constants/plan-features';
import type { BillingPlanCode } from '@/constants/billing-plans';
import { billingBtnBack, billingBtnSolid, billingSpinner } from '@/constants/billing-ui';
import { callRpcRest } from '@/utils/supabase-rest-rpc';

const ADMIN_MASTER = 1;

type MatrixCell = Record<BillingPlanCode, Record<PlanFeatureKey, boolean>>;

function buildEmptyMatrix(): MatrixCell {
    const m = {} as MatrixCell;
    for (const plan of BILLING_PLAN_COLUMNS) {
        m[plan.code] = {} as Record<PlanFeatureKey, boolean>;
        for (const def of PLAN_FEATURE_DEFINITIONS) {
            m[plan.code][def.key] = false;
        }
    }
    return m;
}

const AdminPlanFeatures: React.FC = () => {
    const navigate = useNavigate();
    const { userId, sessionReady, tipoUsuarioId } = usePublicSiteAuth();
    const { authPending } = usePageAuth();
    const [matrix, setMatrix] = useState<MatrixCell>(buildEmptyMatrix);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const isAdminMaster = Number(tipoUsuarioId ?? 0) === ADMIN_MASTER;

    useEffect(() => {
        if (!sessionReady) return;
        if (userId && !isAdminMaster && tipoUsuarioId != null) {
            showError('Acesso negado. Apenas Admin Master.');
            navigate('/manager/dashboard');
        }
    }, [sessionReady, userId, isAdminMaster, tipoUsuarioId, navigate]);

    useEffect(() => {
        if (!sessionReady || !userId || !isAdminMaster) return;

        let cancelled = false;

        const load = async () => {
            setLoading(true);
            try {
                let rows: Array<{ billing_plan: string; feature_key: string; enabled: boolean }> = [];

                try {
                    const data = await callRpcRest<unknown[]>(
                        'admin_get_billing_plan_features_matrix',
                        {},
                        12_000,
                    );
                    rows = Array.isArray(data) ? (data as typeof rows) : [];
                } catch (restError) {
                    throw restError;
                }

                if (cancelled) return;

                const next = buildEmptyMatrix();
                for (const row of rows) {
                    const plan = row.billing_plan as BillingPlanCode;
                    const key = row.feature_key as PlanFeatureKey;
                    if (next[plan] && key in next[plan]) {
                        next[plan][key] = !!row.enabled;
                    }
                }
                setMatrix(next);
            } catch (err) {
                if (!cancelled) {
                    showError(
                        'Erro ao carregar permissões: ' +
                            (err instanceof Error ? err.message : 'tente novamente'),
                    );
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        void load();

        return () => {
            cancelled = true;
        };
    }, [sessionReady, userId, isAdminMaster]);

    const groups = useMemo(() => {
        const g = new Map<string, typeof PLAN_FEATURE_DEFINITIONS>();
        for (const def of PLAN_FEATURE_DEFINITIONS) {
            const list = g.get(def.group) ?? [];
            list.push(def);
            g.set(def.group, list);
        }
        return Array.from(g.entries());
    }, []);

    const toggle = (plan: BillingPlanCode, key: PlanFeatureKey, checked: boolean) => {
        setMatrix((prev) => ({
            ...prev,
            [plan]: { ...prev[plan], [key]: checked },
        }));
    };

    const handleSave = async () => {
        setSaving(true);
        const toastId = showLoading('Salvando permissões...');
        const rows: Array<{ billing_plan: string; feature_key: string; enabled: boolean }> = [];
        for (const plan of BILLING_PLAN_COLUMNS) {
            for (const def of PLAN_FEATURE_DEFINITIONS) {
                rows.push({
                    billing_plan: plan.code,
                    feature_key: def.key,
                    enabled: matrix[plan.code][def.key],
                });
            }
        }

        try {
            await callRpcRest('admin_save_billing_plan_features', { p_rows: rows }, 15_000);
            showSuccess('Permissões por plano atualizadas.');
        } catch (err) {
            showError('Falha ao salvar: ' + (err instanceof Error ? err.message : 'tente novamente'));
        } finally {
            dismissToast(toastId);
            setSaving(false);
        }
    };

    if (authPending || !sessionReady || !userId || loading) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <Loader2 className={`h-10 w-10 animate-spin ${billingSpinner} mx-auto mb-4`} />
                <p className="text-gray-400">Carregando...</p>
            </div>
        );
    }

    if (!isAdminMaster) return null;

    return (
        <div className="max-w-7xl mx-auto">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-serif text-cyan-400 flex items-center gap-3">
                        <Shield className="h-8 w-8" />
                        Planos e permissões
                    </h1>
                    <p className="text-gray-400 text-sm mt-2">
                        Defina quais menus e áreas do painel gestor cada plano comercial pode usar. O gestor
                        só vê as permissões após confirmar o contrato do plano.
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button type="button" onClick={() => navigate('/admin/dashboard')} className={billingBtnBack}>
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Voltar
                    </Button>
                    <Button type="button" onClick={handleSave} disabled={saving} className={billingBtnSolid}>
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Salvar
                    </Button>
                </div>
            </div>

            <Card className="bg-black border border-cyan-500/30 rounded-2xl overflow-hidden">
                <CardHeader>
                    <CardTitle className="text-cyan-400 text-lg">Matriz plano × funcionalidade</CardTitle>
                    <CardDescription className="text-gray-400">
                        Plano Consumo / licença: parceiros não usam Eventos nem Ingressos (só PDV e
                        estabelecimentos). Empresas parceiras também têm bloqueio extra por{' '}
                        <code className="text-cyan-300">company_kind=partner</code>.
                    </CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-sm border-collapse">
                        <thead>
                            <tr className="border-b border-cyan-500/20">
                                <th className="text-left py-3 pr-4 text-gray-400 font-medium w-[28%]">
                                    Funcionalidade
                                </th>
                                {BILLING_PLAN_COLUMNS.map((plan) => (
                                    <th
                                        key={plan.code}
                                        className="text-center py-3 px-2 text-cyan-400/90 font-medium text-xs"
                                    >
                                        {plan.label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {groups.map(([groupName, defs]) => (
                                <React.Fragment key={groupName}>
                                    <tr className="bg-cyan-500/5">
                                        <td
                                            colSpan={1 + BILLING_PLAN_COLUMNS.length}
                                            className="py-2 px-2 text-xs uppercase tracking-wide text-cyan-500/80 font-semibold"
                                        >
                                            {groupName}
                                        </td>
                                    </tr>
                                    {defs.map((def) => (
                                        <tr
                                            key={def.key}
                                            className="border-b border-cyan-500/10 hover:bg-black/40"
                                        >
                                            <td className="py-3 pr-4">
                                                <p className="text-white font-medium">{def.label}</p>
                                                <p className="text-gray-500 text-xs">{def.description}</p>
                                            </td>
                                            {BILLING_PLAN_COLUMNS.map((plan) => (
                                                <td key={plan.code} className="text-center py-3">
                                                    <Checkbox
                                                        checked={matrix[plan.code][def.key]}
                                                        onCheckedChange={(v) =>
                                                            toggle(plan.code, def.key, v === true)
                                                        }
                                                        className="border-cyan-500/50 data-[state=checked]:bg-cyan-400 data-[state=checked]:text-black"
                                                    />
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                </CardContent>
            </Card>
        </div>
    );
};

export default AdminPlanFeatures;

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Loader2, Shield } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { billingAccentText, billingPanelBorder, billingSpinner } from '@/constants/billing-ui';

interface BypassLogRow {
    id: string;
    action_type: string;
    summary: string;
    company_id: string | null;
    event_id: string | null;
    actor_email: string | null;
    company_name: string | null;
    created_at: string;
}

async function fetchBypassLog(): Promise<BypassLogRow[]> {
    const { data, error } = await supabase.rpc('admin_list_master_bypass_log', { p_limit: 80 });
    if (error) throw new Error(error.message);
    const rows = (data as { rows?: BypassLogRow[] })?.rows;
    return Array.isArray(rows) ? rows : [];
}

interface AdminMasterBypassLogSectionProps {
    enabled: boolean;
}

const AdminMasterBypassLogSection: React.FC<AdminMasterBypassLogSectionProps> = ({ enabled }) => {
    const { data, isLoading, isError, error } = useQuery({
        queryKey: ['adminMasterBypassLog'],
        queryFn: fetchBypassLog,
        enabled,
        staleTime: 60_000,
    });

    if (!enabled) return null;

    return (
        <Card className={`bg-black/40 border ${billingPanelBorder} mb-6`}>
            <CardHeader>
                <CardTitle className={`${billingAccentText} text-lg flex items-center gap-2`}>
                    <Shield className="h-5 w-5" />
                    Log de bypass Admin Master
                </CardTitle>
                <CardDescription className="text-gray-400">
                    Registro de ações em que o Admin Master contornou validações anti-fraude (mínimo de ingressos ou
                    inatividade comercial).
                </CardDescription>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <div className="text-center py-8">
                        <Loader2 className={`h-6 w-6 animate-spin ${billingSpinner} mx-auto`} />
                    </div>
                ) : isError ? (
                    <p className="text-red-400 text-sm">
                        Erro ao carregar o log de bypass.
                        {error instanceof Error && error.message ? (
                            <span className="block mt-1 text-red-300/80 text-xs">{error.message}</span>
                        ) : null}
                    </p>
                ) : !data?.length ? (
                    <p className="text-gray-500 text-sm">Nenhum bypass registrado ainda.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="border-cyan-500/20">
                                    <TableHead className="text-gray-400">Data</TableHead>
                                    <TableHead className="text-gray-400">Ação</TableHead>
                                    <TableHead className="text-gray-400">Resumo</TableHead>
                                    <TableHead className="text-gray-400">Admin</TableHead>
                                    <TableHead className="text-gray-400">Empresa</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {data.map((row) => (
                                    <TableRow key={row.id} className="border-cyan-500/10">
                                        <TableCell className="text-gray-300 text-xs whitespace-nowrap">
                                            {format(new Date(row.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                                        </TableCell>
                                        <TableCell className="text-cyan-300 text-xs">{row.action_type}</TableCell>
                                        <TableCell className="text-gray-300 text-sm max-w-md">{row.summary}</TableCell>
                                        <TableCell className="text-gray-400 text-xs">{row.actor_email ?? '—'}</TableCell>
                                        <TableCell className="text-gray-400 text-xs">{row.company_name ?? '—'}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

export default AdminMasterBypassLogSection;

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Database, ArrowLeft, Loader2, Download, AlertCircle } from 'lucide-react';
import { showSuccess, showError, showLoading, dismissToast } from '@/utils/toast';
import { supabase, supabaseUrl, supabaseAnonKey } from '@/integrations/supabase/client';

const ManagerDatabaseBackup: React.FC = () => {
    const navigate = useNavigate();
    const [isExporting, setIsExporting] = useState(false);

    const getBackupFileName = () => {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const h = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        return `backup_${y}${m}${d}_${h}${min}${s}.sql`;
    };

    const handleBackup = async () => {
        setIsExporting(true);
        const toastId = showLoading('Gerando backup do banco de dados...');

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) {
                dismissToast(toastId);
                showError('Sessão inválida. Faça login novamente.');
                return;
            }

            const url = `${supabaseUrl}/functions/v1/backup-database`;
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`,
                    'apikey': supabaseAnonKey,
                },
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err?.error ?? `Erro ${res.status}`);
            }

            const blob = await res.blob();
            const filename = getBackupFileName();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);

            dismissToast(toastId);
            showSuccess(`Backup salvo como ${filename}`);
        } catch (e: unknown) {
            dismissToast(toastId);
            const msg = e instanceof Error ? e.message : 'Falha ao gerar backup.';
            showError(msg);
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-0">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center">
                    <Database className="h-7 w-7 mr-3" />
                    Backup do Banco de Dados
                </h1>
                <Button
                    onClick={() => navigate('/manager/settings/advanced')}
                    variant="outline"
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 text-sm"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                </Button>
            </div>

            <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10">
                <CardHeader>
                    <CardTitle className="text-white text-xl sm:text-2xl font-semibold flex items-center">
                        <Database className="mr-2 h-6 w-6 text-yellow-500" />
                        Realizar backup via SQL
                    </CardTitle>
                    <CardDescription className="text-gray-400 text-sm">
                        Gera um arquivo SQL com o nome <strong>backup_AAAAMMDD_HHmmss.sql</strong> contendo o esquema (tabelas, chaves, políticas RLS) e os dados do esquema público. Restaurar o arquivo em um banco limpo deixa o sistema pronto para uso.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="flex items-center justify-between p-4 bg-black/70 rounded-xl border border-yellow-500/20">
                        <div>
                            <p className="text-white font-medium">Exportar banco (esquema público)</p>
                            <p className="text-gray-400 text-xs mt-1">
                                Inclui: tabelas, primary keys, foreign keys, políticas RLS e todos os dados (INSERTs). Usuários de autenticação e Edge Functions devem ser tratados pelo Dashboard/CLI do Supabase.
                            </p>
                        </div>
                        <Button
                            onClick={handleBackup}
                            disabled={isExporting}
                            className="bg-yellow-500 text-black hover:bg-yellow-600 shrink-0 ml-4"
                        >
                            {isExporting ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Gerando...
                                </>
                            ) : (
                                <>
                                    <Download className="mr-2 h-4 w-4" />
                                    Realizar backup agora
                                </>
                            )}
                        </Button>
                    </div>

                    <div className="flex gap-3 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5">
                        <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                        <div className="text-sm text-amber-200/90">
                            <p className="font-medium text-amber-400">Acesso restrito</p>
                            <p className="text-gray-400 mt-1">
                                Este recurso é exclusivo para <strong>Administrador Global</strong>. Proprietários, gestores de eventos e clientes não têm acesso a esta página.
                            </p>
                        </div>
                    </div>

                    <div className="pt-4">
                        <Button
                            onClick={() => navigate('/manager/settings/advanced')}
                            variant="outline"
                            className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                        >
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Voltar para Configurações Avançadas
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default ManagerDatabaseBackup;

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Loader2, History, User, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/hooks/use-profile';
import { showError } from '@/utils/toast';
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";

interface HistoryEntry {
    id: string;
    user_id: string;
    changed_at: string;
    old_settings: any;
    new_settings: any;
    changed_by: string;
    change_type: string;
}

const fetchSettingsHistory = async (userId: string): Promise<HistoryEntry[]> => {
    // A RLS já garante que o usuário só veja o próprio histórico
    const { data, error } = await supabase
        .from('manager_settings_history')
        .select('*')
        .eq('user_id', userId)
        .order('changed_at', { ascending: false });

    if (error) {
        console.error("Error fetching settings history:", error);
        throw new Error(error.message);
    }
    
    return data as HistoryEntry[];
};

const formatJson = (json: any): string => {
    if (!json) return "{}";
    try {
        // Remove campos de metadados que não são relevantes para a auditoria visual
        const cleanedJson = { ...json };
        delete cleanedJson.created_at;
        delete cleanedJson.updated_at;
        delete cleanedJson.user_id;
        delete cleanedJson.id;
        
        return JSON.stringify(cleanedJson, null, 2);
    } catch (e) {
        return JSON.stringify(json, null, 2);
    }
};

const ManagerSettingsHistory: React.FC = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState<string | undefined>(undefined);
    const { profile, isLoading: isLoadingProfile } = useProfile(userId);
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isError, setIsError] = useState(false);

    useEffect(() => {
        const loadData = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                navigate('/login');
                return;
            }
            setUserId(user.id);
            
            try {
                const data = await fetchSettingsHistory(user.id);
                setHistory(data);
            } catch (e) {
                setIsError(true);
                showError("Falha ao carregar o histórico de configurações.");
            } finally {
                setIsLoading(false);
            }
        };
        loadData();
    }, [navigate]);

    if (isLoading || isLoadingProfile) {
        return (
            <div className="max-w-4xl mx-auto px-4 sm:px-0 text-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando histórico de configurações...</p>
            </div>
        );
    }

    if (isError) {
        return <div className="text-red-400 text-center py-10">Erro ao carregar histórico.</div>;
    }

    return (
        <div className="max-w-7xl mx-auto">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center">
                    <History className="h-7 w-7 mr-3" />
                    Histórico de Configurações
                </h1>
                <Button 
                    onClick={() => navigate('/manager/settings')}
                    variant="outline"
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 text-sm"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                </Button>
            </div>

            <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10 p-6">
                <CardHeader className="p-0 mb-4">
                    <CardDescription className="text-gray-400 text-sm">
                        Registro de todas as alterações feitas nas configurações de Notificação e Pagamento.
                    </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    {history.length === 0 ? (
                        <div className="text-center py-10 text-gray-400">
                            Nenhuma alteração de configuração registrada ainda.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table className="w-full min-w-[700px]">
                                <TableHeader>
                                    <TableRow className="border-b border-yellow-500/20 text-sm hover:bg-black/40">
                                        <TableHead className="text-left text-gray-400 font-semibold py-3 w-[20%]">Tipo</TableHead>
                                        <TableHead className="text-left text-gray-400 font-semibold py-3 w-[30%]">Data da Alteração</TableHead>
                                        <TableHead className="text-left text-gray-400 font-semibold py-3 w-[20%]">Alterado Por</TableHead>
                                        <TableHead className="text-right text-gray-400 font-semibold py-3 w-[30%]">Detalhes</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {history.map((entry) => (
                                        <TableRow 
                                            key={entry.id} 
                                            className="border-b border-yellow-500/10 hover:bg-black/40 transition-colors text-sm"
                                        >
                                            <TableCell className="py-4">
                                                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-400">
                                                    {entry.change_type}
                                                </span>
                                            </TableCell>
                                            <TableCell className="py-4 text-white">
                                                {new Date(entry.changed_at).toLocaleString('pt-BR')}
                                            </TableCell>
                                            <TableCell className="py-4 text-gray-300">
                                                {entry.changed_by === profile?.id ? 'Você' : entry.changed_by.substring(0, 8) + '...'}
                                            </TableCell>
                                            <TableCell className="py-4 text-right">
                                                <Accordion type="single" collapsible className="w-full">
                                                    <AccordionItem value={entry.id} className="border-none">
                                                        <AccordionTrigger className="text-yellow-500 hover:text-yellow-400 justify-end py-0">
                                                            Ver Diff
                                                        </AccordionTrigger>
                                                        <AccordionContent className="pt-2 pb-0">
                                                            <div className="space-y-4 text-left">
                                                                <div className="bg-black/70 p-3 rounded-lg border border-yellow-500/20">
                                                                    <p className="text-red-400 font-semibold mb-1 text-xs">Antes (OLD)</p>
                                                                    <pre className="text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap">
                                                                        {formatJson(entry.old_settings)}
                                                                    </pre>
                                                                </div>
                                                                <div className="bg-black/70 p-3 rounded-lg border border-yellow-500/20">
                                                                    <p className="text-green-400 font-semibold mb-1 text-xs">Depois (NEW)</p>
                                                                    <pre className="text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap">
                                                                        {formatJson(entry.new_settings)}
                                                                    </pre>
                                                                </div>
                                                            </div>
                                                        </AccordionContent>
                                                    </AccordionItem>
                                                </Accordion>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

export default ManagerSettingsHistory;
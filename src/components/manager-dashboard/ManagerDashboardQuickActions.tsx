import React from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, ChevronDown, Download, Plus, QrCode, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    dashAccent,
    dashBtnSolid,
    dashMuted,
    dashPanel,
    dashTitle,
} from '@/constants/manager-dashboard-ui';

const ManagerDashboardQuickActions: React.FC = () => {
    const navigate = useNavigate();

    return (
        <div className={`${dashPanel} mb-8`}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h3 className={dashTitle}>Ações rápidas</h3>
                    <p className={`${dashMuted} text-sm mt-1`}>Atalhos de gerenciamento do dia a dia</p>
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button className={`${dashBtnSolid} cursor-pointer`}>
                            <Settings className="mr-2 h-4 w-4" />
                            Gerenciamento
                            <ChevronDown className="ml-2 h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-56 bg-black/95 border border-cyan-500/30 text-white">
                        <DropdownMenuLabel className={dashAccent}>Eventos e ingressos</DropdownMenuLabel>
                        <DropdownMenuSeparator className="bg-cyan-500/20" />
                        <DropdownMenuItem
                            onClick={() => navigate('/manager/events/create')}
                            className="cursor-pointer focus:bg-cyan-500/10"
                        >
                            <Plus className="mr-2 h-4 w-4" />
                            Criar novo evento
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={() => navigate('/manager/wristbands/create')}
                            className="cursor-pointer focus:bg-cyan-500/10"
                        >
                            <QrCode className="mr-2 h-4 w-4" />
                            Gerar ingressos
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-cyan-500/20" />
                        <DropdownMenuItem
                            onClick={() => navigate('/manager/reports')}
                            className="cursor-pointer focus:bg-cyan-500/10"
                        >
                            <BarChart3 className="mr-2 h-4 w-4" />
                            Relatórios
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={() => navigate('/manager/reports/sales')}
                            className="cursor-pointer focus:bg-cyan-500/10"
                        >
                            <Download className="mr-2 h-4 w-4" />
                            Relatório de vendas
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    );
};

export default ManagerDashboardQuickActions;

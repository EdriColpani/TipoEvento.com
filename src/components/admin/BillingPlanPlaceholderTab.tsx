import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Clock } from 'lucide-react';

interface BillingPlanPlaceholderTabProps {
    title: string;
    description: string;
}

const BillingPlanPlaceholderTab: React.FC<BillingPlanPlaceholderTabProps> = ({ title, description }) => (
    <Card className="bg-black/40 border border-cyan-500/20 opacity-80">
        <CardHeader>
            <CardTitle className="text-gray-400 text-lg flex items-center gap-2">
                <Clock className="h-5 w-5" />
                {title}
            </CardTitle>
            <CardDescription className="text-gray-500">{description}</CardDescription>
        </CardHeader>
        <CardContent>
            <p className="text-amber-400/90 text-sm">
                Em breve — parâmetros de cobrança deste plano serão configurados aqui na mesma tela de{' '}
                <strong>Preços e comissões</strong>.
            </p>
        </CardContent>
    </Card>
);

export default BillingPlanPlaceholderTab;

import React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { TAX_GUIDE_TYPES } from '@/hooks/use-admin-tax-guides';

const SELECT_CLS = 'bg-black/60 border-yellow-500/30 text-white mt-1';
const INPUT_CLS = 'bg-black border-yellow-500/30 text-white mt-1';

type Props = {
    taxType: string;
    description: string;
    dueDate: string;
    amount: string;
    busy: boolean;
    onTaxType: (v: string) => void;
    onDescription: (v: string) => void;
    onDueDate: (v: string) => void;
    onAmount: (v: string) => void;
    onSubmit: () => void;
};

const AdminTaxGuideCreateForm: React.FC<Props> = ({
    taxType,
    description,
    dueDate,
    amount,
    busy,
    onTaxType,
    onDescription,
    onDueDate,
    onAmount,
    onSubmit,
}) => (
    <Card className="bg-black border-yellow-500/30">
        <CardHeader>
            <CardTitle className="text-white text-base">Lançar guia</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
                <Label className="text-gray-400 text-xs">Tipo do imposto</Label>
                <Select value={taxType} onValueChange={onTaxType}>
                    <SelectTrigger className={SELECT_CLS}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-black border-yellow-500/30 text-white">
                        {TAX_GUIDE_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>
                                {t}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <div className="sm:col-span-2">
                <Label className="text-gray-400 text-xs">Descrição do imposto</Label>
                <Input
                    value={description}
                    onChange={(e) => onDescription(e.target.value)}
                    placeholder="Ex.: DAS competência 08/2026"
                    className={INPUT_CLS}
                />
            </div>
            <div>
                <Label className="text-gray-400 text-xs">Vencimento</Label>
                <Input type="date" value={dueDate} onChange={(e) => onDueDate(e.target.value)} className={INPUT_CLS} />
            </div>
            <div>
                <Label className="text-gray-400 text-xs">Valor da guia</Label>
                <Input
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => onAmount(e.target.value)}
                    placeholder="0,00"
                    className={INPUT_CLS}
                />
            </div>
            <div className="flex items-end">
                <Button
                    type="button"
                    className="bg-yellow-500 text-black hover:bg-yellow-600 disabled:opacity-50"
                    onClick={onSubmit}
                    disabled={busy}
                >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    Lançar como A pagar
                </Button>
            </div>
        </CardContent>
    </Card>
);

export default AdminTaxGuideCreateForm;

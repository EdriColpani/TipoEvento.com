import React, { useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import {
    FormControl,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { useCompanyEventCategories } from '@/hooks/use-company-event-categories';
import { showError, showSuccess } from '@/utils/toast';

type CompanyEventCategoryFieldProps = {
    companyId: string | undefined;
    value: string;
    onChange: (value: string) => void;
};

const CompanyEventCategoryField: React.FC<CompanyEventCategoryFieldProps> = ({
    companyId,
    value,
    onChange,
}) => {
    const { categories, isLoading, createCategory, isCreating } =
        useCompanyEventCategories(companyId);
    const [modalOpen, setModalOpen] = useState(false);
    const [newName, setNewName] = useState('');

    const handleCreate = async () => {
        const trimmed = newName.trim();
        if (trimmed.length < 2) {
            showError('Informe um nome com pelo menos 2 caracteres.');
            return;
        }
        try {
            const created = await createCategory(trimmed);
            onChange(created.name);
            showSuccess(`Categoria "${created.name}" criada.`);
            setNewName('');
            setModalOpen(false);
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Erro ao criar categoria.');
        }
    };

    return (
        <FormItem>
            <FormLabel className="text-white">Categoria</FormLabel>
            <div className="flex gap-2 items-start">
                <Select
                    value={value || undefined}
                    onValueChange={onChange}
                    disabled={isLoading || !companyId || categories.length === 0}
                >
                    <FormControl>
                        <SelectTrigger className="bg-black/60 border-yellow-500/30 text-white focus:ring-yellow-500 flex-1 min-w-0">
                            <SelectValue
                                placeholder={
                                    isLoading
                                        ? 'Carregando categorias…'
                                        : !companyId
                                          ? 'Vincule uma empresa primeiro'
                                          : categories.length === 0
                                            ? 'Nenhuma categoria — use +'
                                            : 'Selecione uma categoria'
                                }
                            />
                        </SelectTrigger>
                    </FormControl>
                    <SelectContent className="bg-black border border-yellow-500/30 text-white">
                        {categories.map((cat) => (
                            <SelectItem
                                key={cat.id}
                                value={cat.name}
                                className="hover:bg-yellow-500/10"
                            >
                                {cat.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                {companyId && (
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="shrink-0 border-yellow-500/40 text-yellow-500 hover:bg-yellow-500/10 h-10 w-10"
                        title="Nova categoria"
                        disabled={!companyId || isCreating}
                        onClick={() => setModalOpen(true)}
                    >
                        {isCreating ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Plus className="h-4 w-4" />
                        )}
                    </Button>
                )}
            </div>
            {categories.length > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                    Categorias da sua empresa. Use + para cadastrar outra.
                </p>
            )}
            <FormMessage />

            <Dialog open={modalOpen} onOpenChange={setModalOpen}>
                <DialogContent className="bg-black/95 border border-yellow-500/30 text-white max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-yellow-400">Nova categoria</DialogTitle>
                        <DialogDescription className="text-gray-400">
                            A categoria ficará disponível para os eventos desta empresa.
                        </DialogDescription>
                    </DialogHeader>
                    <Input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="Ex: Cultura, Festa infantil…"
                        className="bg-black/60 border-yellow-500/30 text-white"
                        maxLength={80}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                handleCreate();
                            }
                        }}
                    />
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button
                            type="button"
                            variant="outline"
                            className="border-yellow-500/30 text-yellow-500"
                            onClick={() => setModalOpen(false)}
                        >
                            Cancelar
                        </Button>
                        <Button
                            type="button"
                            className="bg-yellow-500 text-black hover:bg-yellow-600"
                            disabled={isCreating}
                            onClick={handleCreate}
                        >
                            {isCreating ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : null}
                            Salvar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </FormItem>
    );
};

export default CompanyEventCategoryField;

import React, { useEffect, useMemo, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from '@/components/ui/accordion';
import {
    REPORTS_GUIDE_INTRO,
    filterReportsGuideForUser,
    type ReportsGuideEntry,
} from '@/constants/reports-guide';

type ReportsGuideDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    isAdminMaster: boolean;
    /** Abre o accordion já focado neste relatório */
    focusEntryId?: string | null;
};

function EntryBody({ entry }: { entry: ReportsGuideEntry }) {
    return (
        <div className="space-y-4 text-sm text-gray-300 pb-2">
            <div>
                <p className="text-yellow-500/90 font-medium mb-1">Para que serve</p>
                <p className="text-gray-300 leading-relaxed">{entry.purpose}</p>
            </div>
            <div>
                <p className="text-yellow-500/90 font-medium mb-1">Como funciona / o que mostra</p>
                <ul className="list-disc list-inside space-y-1.5 text-gray-400">
                    {entry.howItWorks.map((line) => (
                        <li key={line} className="leading-relaxed">
                            {line}
                        </li>
                    ))}
                </ul>
            </div>
            {entry.tips && entry.tips.length > 0 && (
                <div>
                    <p className="text-yellow-500/90 font-medium mb-1">Dicas</p>
                    <ul className="list-disc list-inside space-y-1.5 text-gray-400">
                        {entry.tips.map((line) => (
                            <li key={line} className="leading-relaxed">
                                {line}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {entry.matchesWith && (
                <div className="rounded-lg border border-cyan-500/30 bg-cyan-950/40 px-3 py-2">
                    <p className="text-cyan-200 text-xs font-medium mb-1">Deve bater com</p>
                    <p className="text-cyan-50/90 text-xs leading-relaxed">{entry.matchesWith}</p>
                </div>
            )}
            {entry.audience === 'admin' && (
                <p className="text-[11px] uppercase tracking-wide text-amber-400/80">
                    Exclusivo Admin Master
                </p>
            )}
            {entry.audience === 'gestor' && (
                <p className="text-[11px] uppercase tracking-wide text-gray-500">
                    Visão do gestor / empresa
                </p>
            )}
        </div>
    );
}

const ReportsGuideDialog: React.FC<ReportsGuideDialogProps> = ({
    open,
    onOpenChange,
    isAdminMaster,
    focusEntryId = null,
}) => {
    const entries = useMemo(
        () => filterReportsGuideForUser(isAdminMaster),
        [isAdminMaster],
    );

    const gestorEntries = useMemo(
        () => entries.filter((e) => e.audience === 'gestor' || e.audience === 'both'),
        [entries],
    );
    const adminEntries = useMemo(
        () => entries.filter((e) => e.audience === 'admin'),
        [entries],
    );

    const [openItems, setOpenItems] = useState<string[]>([]);

    useEffect(() => {
        if (!open) return;
        if (focusEntryId && entries.some((e) => e.id === focusEntryId)) {
            setOpenItems([focusEntryId]);
            // Scroll após o Dialog montar o conteúdo
            window.setTimeout(() => {
                document
                    .getElementById(`reports-guide-${focusEntryId}`)
                    ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }, 80);
        } else {
            setOpenItems([]);
        }
    }, [open, focusEntryId, entries]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="bg-black border border-yellow-500/30 text-white max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="text-yellow-500 font-serif text-xl flex items-center gap-2">
                        <CircleHelp className="h-5 w-5" />
                        {REPORTS_GUIDE_INTRO.title}
                    </DialogTitle>
                    <DialogDescription className="text-gray-400 text-sm leading-relaxed">
                        {REPORTS_GUIDE_INTRO.subtitle}
                    </DialogDescription>
                </DialogHeader>

                <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/50 px-4 py-3 space-y-2">
                    <p className="text-cyan-200 text-sm font-semibold">
                        {REPORTS_GUIDE_INTRO.matchBoxTitle}
                    </p>
                    <ul className="list-disc list-inside space-y-1.5 text-xs text-cyan-50/90">
                        {REPORTS_GUIDE_INTRO.matchBoxItems.map((item) => (
                            <li key={item} className="leading-relaxed">
                                {item}
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="space-y-4 pt-1">
                    <div>
                        <h3 className="text-sm font-semibold text-white mb-2">
                            Relatórios do gestor
                        </h3>
                        <Accordion
                            type="multiple"
                            value={openItems}
                            onValueChange={setOpenItems}
                            className="w-full"
                        >
                            {gestorEntries.map((entry) => (
                                <AccordionItem
                                    key={entry.id}
                                    value={entry.id}
                                    id={`reports-guide-${entry.id}`}
                                    className="border-yellow-500/20"
                                >
                                    <AccordionTrigger className="text-left text-yellow-500 hover:text-yellow-400 hover:no-underline py-3">
                                        <span className="pr-2">
                                            <span className="block font-medium">{entry.title}</span>
                                            <span className="block text-xs font-normal text-gray-500 mt-0.5">
                                                {entry.summary}
                                            </span>
                                        </span>
                                    </AccordionTrigger>
                                    <AccordionContent>
                                        <EntryBody entry={entry} />
                                    </AccordionContent>
                                </AccordionItem>
                            ))}
                        </Accordion>
                    </div>

                    {isAdminMaster && adminEntries.length > 0 && (
                        <div>
                            <h3 className="text-sm font-semibold text-white mb-2">
                                Relatórios Admin Master
                            </h3>
                            <Accordion
                                type="multiple"
                                value={openItems}
                                onValueChange={setOpenItems}
                                className="w-full"
                            >
                                {adminEntries.map((entry) => (
                                    <AccordionItem
                                        key={entry.id}
                                        value={entry.id}
                                        id={`reports-guide-${entry.id}`}
                                        className="border-yellow-500/20"
                                    >
                                        <AccordionTrigger className="text-left text-yellow-500 hover:text-yellow-400 hover:no-underline py-3">
                                            <span className="pr-2">
                                                <span className="block font-medium">{entry.title}</span>
                                                <span className="block text-xs font-normal text-gray-500 mt-0.5">
                                                    {entry.summary}
                                                </span>
                                            </span>
                                        </AccordionTrigger>
                                        <AccordionContent>
                                            <EntryBody entry={entry} />
                                        </AccordionContent>
                                    </AccordionItem>
                                ))}
                            </Accordion>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default ReportsGuideDialog;

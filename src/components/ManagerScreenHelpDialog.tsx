"use client";

import React from 'react';
import { CircleHelp } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    getManagerScreenGuide,
    type ManagerScreenGuideId,
} from '@/constants/manager-screen-guides';

type ManagerScreenHelpDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    guideId: ManagerScreenGuideId;
};

const ManagerScreenHelpDialog: React.FC<ManagerScreenHelpDialogProps> = ({
    open,
    onOpenChange,
    guideId,
}) => {
    const guide = getManagerScreenGuide(guideId);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="bg-black border border-cyan-500/30 text-white max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="text-cyan-400 font-serif text-xl flex items-center gap-2">
                        <CircleHelp className="h-5 w-5" />
                        {guide.title}
                    </DialogTitle>
                    <DialogDescription className="text-gray-400 text-sm leading-relaxed">
                        {guide.subtitle}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-5 text-sm">
                    <div>
                        <p className="text-cyan-400 font-medium mb-1">Para que serve</p>
                        <p className="text-gray-300 leading-relaxed">{guide.purpose}</p>
                    </div>

                    <div>
                        <p className="text-cyan-400 font-medium mb-2">Campos obrigatórios</p>
                        <ul className="space-y-2">
                            {guide.requiredFields.map((item) => (
                                <li
                                    key={item.field}
                                    className="rounded-lg border border-cyan-500/20 bg-cyan-950/30 px-3 py-2"
                                >
                                    <p className="text-white font-medium text-sm">{item.field}</p>
                                    <p className="text-gray-400 text-xs mt-1 leading-relaxed">
                                        {item.detail}
                                    </p>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div>
                        <p className="text-cyan-400 font-medium mb-1">Como preencher / fluxo</p>
                        <ol className="list-decimal list-inside space-y-1.5 text-gray-400">
                            {guide.steps.map((step) => (
                                <li key={step} className="leading-relaxed">
                                    {step}
                                </li>
                            ))}
                        </ol>
                    </div>

                    {guide.sections?.map((section) => (
                        <div key={section.title}>
                            <p className="text-cyan-400 font-medium mb-1">{section.title}</p>
                            <ul className="list-disc list-inside space-y-1.5 text-gray-400">
                                {section.items.map((item) => (
                                    <li key={item} className="leading-relaxed">
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}

                    {guide.tips && guide.tips.length > 0 && (
                        <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/50 px-4 py-3">
                            <p className="text-cyan-200 text-sm font-semibold mb-2">Dicas</p>
                            <ul className="list-disc list-inside space-y-1.5 text-xs text-cyan-50/90">
                                {guide.tips.map((tip) => (
                                    <li key={tip} className="leading-relaxed">
                                        {tip}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default ManagerScreenHelpDialog;

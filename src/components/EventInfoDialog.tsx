import React from 'react';
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Calendar, MapPin } from 'lucide-react';
import { formatEventDateForDisplay } from '@/utils/format-event-date';

export interface EventInfoDialogProps {
    open: boolean;
    onClose: () => void;
    title: string;
    date?: string | null;
    location?: string | null;
    description?: string | null;
}

const EventInfoDialog: React.FC<EventInfoDialogProps> = ({
    open,
    onClose,
    title,
    date,
    location,
    description,
}) => {
    const formattedDate = date ? formatEventDateForDisplay(date) : null;

    return (
        <AlertDialog open={open} onOpenChange={(v) => !v && onClose()}>
            <AlertDialogContent className="bg-black/90 border border-yellow-500/30 text-white max-w-lg">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-yellow-400 text-xl">{title}</AlertDialogTitle>
                    <AlertDialogDescription className="text-gray-400">
                        Informações do evento para sua entrada.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-3 text-sm">
                    {formattedDate && (
                        <div className="flex items-start gap-2 text-gray-300">
                            <Calendar className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
                            <span>{formattedDate}</span>
                        </div>
                    )}
                    {location && (
                        <div className="flex items-start gap-2 text-gray-300">
                            <MapPin className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
                            <span>{location}</span>
                        </div>
                    )}
                    {description ? (
                        <p className="text-gray-400 leading-relaxed border-t border-yellow-500/20 pt-3">
                            {description}
                        </p>
                    ) : (
                        <p className="text-gray-500 italic border-t border-yellow-500/20 pt-3">
                            Sem descrição adicional cadastrada.
                        </p>
                    )}
                </div>
                <AlertDialogFooter>
                    <AlertDialogCancel asChild>
                        <Button
                            variant="outline"
                            className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 w-full"
                        >
                            Fechar
                        </Button>
                    </AlertDialogCancel>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

export default EventInfoDialog;

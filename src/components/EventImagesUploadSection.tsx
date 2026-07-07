"use client";

import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { showSuccess, showError, showLoading, dismissToast } from '@/utils/toast';
import { CheckCircle2, ImageOff, Loader2, UploadCloud, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { uploadEventImage } from '@/utils/supabase-storage-rest';

const PREVIEW_HEIGHT_PX = 140;

type ImageSlotId = 'card' | 'exposure' | 'banner';

const IMAGE_SLOTS: Array<{
    id: ImageSlotId;
    label: string;
    shortLabel: string;
    folderPath: string;
    aspectClass: string;
    recommended: string;
    usage: string;
}> = [
    {
        id: 'card',
        label: 'Card da listagem',
        shortLabel: 'Card',
        folderPath: 'event_cards',
        aspectClass: 'aspect-video',
        recommended: '1920 × 1080 px · 16:9',
        usage: 'Grade e busca de eventos',
    },
    {
        id: 'exposure',
        label: 'Card de exposição',
        shortLabel: 'Exposição',
        folderPath: 'event_exposure_cards',
        aspectClass: 'aspect-video',
        recommended: '1920 × 1080 px · 16:9',
        usage: 'Carrosséis e destaques',
    },
    {
        id: 'banner',
        label: 'Banner da página',
        shortLabel: 'Banner',
        folderPath: 'event_banners',
        aspectClass: 'aspect-[3/1]',
        recommended: '1920 × 640 px · 3:1',
        usage: 'Topo da página pública do evento',
    },
];

interface EventImagesUploadSectionProps {
    userId: string;
    cardUrl: string;
    exposureUrl: string;
    bannerUrl: string;
    onCardChange: (url: string) => void;
    onExposureChange: (url: string) => void;
    onBannerChange: (url: string) => void;
    invalid?: Partial<Record<ImageSlotId, boolean>>;
    disabled?: boolean;
    maxFileSizeMB?: number;
}

function urlForSlot(
    slotId: ImageSlotId,
    props: EventImagesUploadSectionProps,
): string {
    if (slotId === 'card') return props.cardUrl;
    if (slotId === 'exposure') return props.exposureUrl;
    return props.bannerUrl;
}

function onChangeForSlot(
    slotId: ImageSlotId,
    props: EventImagesUploadSectionProps,
): (url: string) => void {
    if (slotId === 'card') return props.onCardChange;
    if (slotId === 'exposure') return props.onExposureChange;
    return props.onBannerChange;
}

const EventImagesUploadSection: React.FC<EventImagesUploadSectionProps> = (props) => {
    const {
        userId,
        disabled = false,
        maxFileSizeMB = 5,
        invalid = {},
    } = props;

    const [uploadingSlot, setUploadingSlot] = useState<ImageSlotId | null>(null);
    const inputRefs = useRef<Partial<Record<ImageSlotId, HTMLInputElement | null>>>({});

    const handlePick = (slotId: ImageSlotId) => {
        if (disabled || uploadingSlot) return;
        inputRefs.current[slotId]?.click();
    };

    const handleClear = (slotId: ImageSlotId) => {
        if (disabled || uploadingSlot) return;
        onChangeForSlot(slotId, props)('');
    };

    const handleFileChange = async (slotId: ImageSlotId, event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (file.size > maxFileSizeMB * 1024 * 1024) {
            showError(`O arquivo é muito grande. Máximo de ${maxFileSizeMB}MB.`);
            return;
        }

        const slot = IMAGE_SLOTS.find((s) => s.id === slotId)!;
        const toastId = showLoading(`Enviando ${slot.shortLabel.toLowerCase()}…`);
        setUploadingSlot(slotId);

        try {
            const publicUrl = await uploadEventImage('event-banners', slot.folderPath, userId, file);
            onChangeForSlot(slotId, props)(publicUrl);
            showSuccess(`${slot.shortLabel} enviado com sucesso!`);
        } catch (error: unknown) {
            console.error('[EventImagesUploadSection] upload failed:', error);
            showError(
                `Falha no upload: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
            );
        } finally {
            dismissToast(toastId);
            setUploadingSlot(null);
            const input = inputRefs.current[slotId];
            if (input) input.value = '';
        }
    };

    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/40 px-4 py-3 text-sm text-cyan-50">
                Envie as imagens <strong className="text-white">depois de preencher os dados</strong> do evento.
                Todas as miniaturas usam a mesma altura na tela para facilitar a revisão.
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {IMAGE_SLOTS.map((slot) => {
                    const currentUrl = urlForSlot(slot.id, props);
                    const isUploading = uploadingSlot === slot.id;
                    const hasImage = Boolean(currentUrl);
                    const isInvalid = Boolean(invalid[slot.id]);

                    return (
                        <div
                            key={slot.id}
                            className={cn(
                                'rounded-xl border bg-black/40 p-4 flex flex-col gap-3',
                                isInvalid ? 'border-red-500/70' : 'border-yellow-500/30',
                            )}
                        >
                            <div className="flex items-start justify-between gap-2 min-h-[40px]">
                                <div>
                                    <p className="text-white text-sm font-medium">{slot.label}</p>
                                    <p className="text-gray-500 text-xs mt-0.5">{slot.usage}</p>
                                </div>
                                {hasImage && !isUploading && (
                                    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" aria-hidden />
                                )}
                            </div>

                            <button
                                type="button"
                                disabled={disabled || isUploading}
                                onClick={() => handlePick(slot.id)}
                                className={cn(
                                    'relative w-full rounded-lg overflow-hidden border bg-black/60',
                                    'flex items-center justify-center transition-colors',
                                    'hover:border-yellow-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500/50',
                                    isInvalid ? 'border-red-500/60' : 'border-yellow-500/20',
                                    slot.aspectClass,
                                )}
                                style={{ maxHeight: PREVIEW_HEIGHT_PX }}
                                aria-label={hasImage ? `Alterar ${slot.shortLabel}` : `Enviar ${slot.shortLabel}`}
                            >
                                {hasImage ? (
                                    <img
                                        src={currentUrl}
                                        alt={`Prévia ${slot.shortLabel}`}
                                        className="w-full h-full object-cover object-center"
                                    />
                                ) : (
                                    <div className="flex flex-col items-center justify-center text-gray-500 p-3">
                                        <ImageOff className="h-6 w-6 mb-1" />
                                        <span className="text-xs">Clique para enviar</span>
                                    </div>
                                )}

                                <div
                                    className={cn(
                                        'absolute inset-0 bg-black/55 flex items-center justify-center transition-opacity',
                                        isUploading ? 'opacity-100' : 'opacity-0 hover:opacity-100',
                                    )}
                                >
                                    {isUploading ? (
                                        <Loader2 className="h-7 w-7 animate-spin text-yellow-500" />
                                    ) : (
                                        <UploadCloud className="h-7 w-7 text-yellow-500" />
                                    )}
                                </div>
                            </button>

                            <input
                                ref={(el) => {
                                    inputRefs.current[slot.id] = el;
                                }}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                disabled={disabled || isUploading}
                                onChange={(e) => void handleFileChange(slot.id, e)}
                            />

                            <div className="flex gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={disabled || isUploading}
                                    onClick={() => handlePick(slot.id)}
                                    className="flex-1 bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 text-xs h-9 disabled:opacity-50"
                                >
                                    {isUploading ? (
                                        <>
                                            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                                            Enviando…
                                        </>
                                    ) : (
                                        <>
                                            <UploadCloud className="h-3.5 w-3.5 mr-1.5" />
                                            {hasImage ? 'Trocar' : 'Enviar'}
                                        </>
                                    )}
                                </Button>
                                {hasImage && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        disabled={disabled || isUploading}
                                        onClick={() => handleClear(slot.id)}
                                        className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 h-9 px-3 disabled:opacity-50"
                                        aria-label={`Remover ${slot.shortLabel}`}
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </Button>
                                )}
                            </div>

                            <p className="text-gray-500 text-[11px] leading-snug">
                                {slot.recommended} · JPG, PNG ou GIF (máx. {maxFileSizeMB}MB)
                            </p>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default EventImagesUploadSection;

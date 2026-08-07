"use client";

import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { showSuccess, showError, showLoading, dismissToast } from '@/utils/toast';
import { ImageOff, UploadCloud, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { uploadEventImage } from '@/utils/supabase-storage-rest';

interface ImageUploadPickerProps {
    userId: string;
    currentImageUrl: string | null;
    onImageUpload: (url: string) => void;
    disabled?: boolean;
    width: number;
    height: number;
    placeholderText: string;
    bucketName?: string;
    folderPath?: string;
    maxFileSizeMB?: number;
    isInvalid?: boolean;
    uploadButtonLabel?: string;
    /** Preview com largura fixa (não estica 100% da linha). Ideal para foto de produto. */
    compact?: boolean;
    objectFit?: 'cover' | 'contain';
}

const ImageUploadPicker: React.FC<ImageUploadPickerProps> = ({
    userId,
    currentImageUrl,
    onImageUpload,
    disabled = false,
    width,
    height,
    placeholderText,
    bucketName = 'event-banners',
    folderPath = 'banners',
    maxFileSizeMB = 5,
    isInvalid = false,
    uploadButtonLabel = 'Escolher imagem',
    compact = false,
    objectFit = 'cover',
}) => {
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (file.size > maxFileSizeMB * 1024 * 1024) {
            showError(`O arquivo é muito grande. Máximo de ${maxFileSizeMB}MB.`);
            return;
        }

        const toastId = showLoading("Enviando imagem...");
        setUploading(true);

        try {
            const publicUrl = await uploadEventImage(bucketName, folderPath, userId, file);
            onImageUpload(publicUrl);
            showSuccess("Imagem enviada com sucesso!");

        } catch (error: any) {
            console.error('Upload failed:', error);
            showError(`Falha no upload: ${error.message || 'Erro desconhecido'}`);
        } finally {
            dismissToast(toastId);
            setUploading(false);
            // Reset file input to allow re-uploading the same file if needed
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const handleButtonClick = () => {
        if (disabled || uploading) return;
        if (fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    return (
        <div className={cn('space-y-3', compact && 'max-w-full')} style={compact ? { width: Math.min(width, 200) } : undefined}>
            <div 
                className={cn(
                    "bg-black/60 border rounded-xl overflow-hidden flex items-center justify-center relative",
                    "group cursor-pointer hover:border-yellow-500/60 transition-all duration-300",
                    compact ? 'w-full' : 'w-full',
                    isInvalid ? "border-red-500" : "border-yellow-500/30"
                )}
                style={{
                    height: `${compact ? Math.min(height, 160) : height}px`,
                    maxWidth: compact ? `${Math.min(width, 200)}px` : undefined,
                }}
                onClick={handleButtonClick}
            >
                {currentImageUrl ? (
                    <img 
                        src={currentImageUrl} 
                        alt="Preview" 
                        className={cn(
                            'w-full h-full object-center',
                            objectFit === 'contain' ? 'object-contain bg-black/40' : 'object-cover',
                        )}
                        onError={(e) => {
                            e.currentTarget.onerror = null; 
                            e.currentTarget.src = 'placeholder.svg'; 
                            e.currentTarget.className = "w-16 h-16 text-gray-500";
                        }}
                    />
                ) : (
                    <div className="text-center text-gray-500 p-3">
                        <ImageOff className="h-6 w-6 mx-auto mb-1" />
                        <p className="text-xs">{placeholderText}</p>
                        <p className="text-[10px] mt-1 opacity-70">({width}×{height})</p>
                    </div>
                )}
                
                {(uploading || !currentImageUrl) && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                        {uploading ? (
                            <Loader2 className="h-6 w-6 animate-spin text-yellow-500" />
                        ) : (
                            <UploadCloud className="h-7 w-7 text-yellow-500" />
                        )}
                    </div>
                )}
            </div>

            <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                onChange={handleFileChange}
                style={{ display: 'none' }}
                disabled={disabled || uploading}
            />
            <Button 
                onClick={handleButtonClick}
                variant="outline" 
                className={cn(
                    'bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400 text-sm h-9',
                    compact ? 'w-full max-w-[200px]' : 'w-full h-10',
                )}
                disabled={disabled || uploading}
                type="button"
            >
                {uploading ? (
                    <div className="flex items-center justify-center">
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        Enviando...
                    </div>
                ) : (
                    <>
                        <UploadCloud className="mr-2 h-4 w-4" />
                        {uploadButtonLabel}
                    </>
                )}
            </Button>
            <p className="text-gray-500 text-xs">
                JPG, PNG ou GIF (máx. {maxFileSizeMB}MB)
                {compact ? '.' : `. Dimensões recomendadas: ${width}x${height}px.`}
            </p>
        </div>
    );
};

export default ImageUploadPicker;
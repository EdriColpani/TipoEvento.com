"use client";

import React, { useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { showSuccess, showError, showLoading, dismissToast } from '@/utils/toast';
import { ImageOff, UploadCloud, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ImageUploadPickerProps {
    userId: string;
    currentImageUrl: string | null;
    onImageUpload: (url: string) => void;
    disabled?: boolean;
    width: number;
    height: number;
    placeholderText: string;
    bucketName?: string; // Default to 'event-banners'
    folderPath?: string; // Default to 'banners'
    maxFileSizeMB?: number; // Default to 5MB
    isInvalid?: boolean; // Adicionando a prop isInvalid
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
    isInvalid = false, // Valor padrão
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
            const fileExt = file.name.split('.').pop();
            const fileName = `${userId}-${Date.now()}.${fileExt}`;
            const filePath = `${folderPath}/${fileName}`;

            // 1. Upload the file to Supabase Storage
            const { error: uploadError } = await supabase.storage
                .from(bucketName)
                .upload(filePath, file, {
                    cacheControl: '3600',
                    upsert: false,
                });

            if (uploadError) {
                throw uploadError;
            }

            // 2. Get the public URL
            const { data: publicUrlData } = supabase.storage
                .from(bucketName)
                .getPublicUrl(filePath);
            
            const publicUrl = publicUrlData.publicUrl;

            // 3. Success: Notify parent component and show toast
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
        <div className="space-y-4">
            <div 
                className={cn(
                    "w-full bg-black/60 border rounded-xl overflow-hidden flex items-center justify-center relative",
                    "group cursor-pointer hover:border-yellow-500/60 transition-all duration-300",
                    isInvalid ? "border-red-500" : "border-yellow-500/30" // Aplica borda vermelha se inválido
                )}
                style={{ height: `${height}px` }}
                onClick={handleButtonClick}
            >
                {currentImageUrl ? (
                    <img 
                        src={currentImageUrl} 
                        alt="Preview do Banner" 
                        className="w-full h-full object-cover object-center"
                        onError={(e) => {
                            e.currentTarget.onerror = null; 
                            e.currentTarget.src = 'placeholder.svg'; 
                            e.currentTarget.className = "w-16 h-16 text-gray-500";
                        }}
                    />
                ) : (
                    <div className="text-center text-gray-500 p-4">
                        <ImageOff className="h-8 w-8 mx-auto mb-2" />
                        <p className="text-sm">{placeholderText}</p>
                        <p className="text-xs mt-1">({width}px de largura por {height}px de altura)</p>
                    </div>
                )}
                
                {(uploading || !currentImageUrl) && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                        {uploading ? (
                            <Loader2 className="h-8 w-8 animate-spin text-yellow-500" />
                        ) : (
                            <UploadCloud className="h-10 w-10 text-yellow-500" />
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
                className="w-full bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 text-sm h-10"
                disabled={disabled || uploading}
                type="button" // Adicionado explicitamente para evitar submissão de formulário
            >
                {uploading ? (
                    <div className="flex items-center justify-center">
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        Enviando...
                    </div>
                ) : (
                    <>
                        <UploadCloud className="mr-2 h-4 w-4" />
                        Escolher Banner
                    </>
                )}
            </Button>
            <p className="text-gray-500 text-xs mt-1">JPG, PNG ou GIF (máx. {maxFileSizeMB}MB). Dimensões recomendadas: {width}x{height}px.</p>
        </div>
    );
};

export default ImageUploadPicker;
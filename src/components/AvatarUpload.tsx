import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { showSuccess, showError, showLoading, dismissToast } from '@/utils/toast';
import { restPatch } from '@/utils/supabase-rest';
import {
    getStoragePublicUrl,
    removeStorageObjectRest,
    uploadStorageObjectRest,
} from '@/utils/supabase-storage-rest';

interface AvatarUploadProps {
    userId: string;
    url: string | null;
    onUpload: (url: string) => void;
    initials: string;
}

const AvatarUpload: React.FC<AvatarUploadProps> = ({ userId, url, onUpload, initials }) => {
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            showError('O arquivo é muito grande. Máximo de 5MB.');
            return;
        }

        const toastId = showLoading('Enviando foto...');
        setUploading(true);

        try {
            const fileExt = file.name.split('.').pop();
            const fileName = `${userId}-${Date.now()}.${fileExt}`;
            const filePath = `avatars/${fileName}`;

            await uploadStorageObjectRest('avatars', filePath, file);
            const publicUrl = getStoragePublicUrl('avatars', filePath);

            try {
                await restPatch(
                    `profiles?id=eq.${encodeURIComponent(userId)}`,
                    { avatar_url: publicUrl },
                );
            } catch (updateError) {
                await removeStorageObjectRest('avatars', filePath);
                throw updateError;
            }

            onUpload(publicUrl);
            showSuccess('Foto de perfil atualizada com sucesso!');
        } catch (error: unknown) {
            console.error('Upload failed:', error);
            showError(`Falha no upload: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
        } finally {
            dismissToast(toastId);
            setUploading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const handleButtonClick = () => {
        fileInputRef.current?.click();
    };

    return (
        <div className="flex items-center space-x-6">
            <Avatar className="h-24 w-24 border-2 border-yellow-500/50">
                <AvatarImage src={url || undefined} alt="Avatar do Usuário" />
                <AvatarFallback className="bg-yellow-500 text-black font-bold text-4xl">{initials}</AvatarFallback>
            </Avatar>
            <div>
                <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                    disabled={uploading}
                />
                <Button
                    onClick={handleButtonClick}
                    variant="outline"
                    className="mt-2 bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 text-sm h-8"
                    disabled={uploading}
                >
                    {uploading ? 'Enviando...' : 'Alterar Foto'}
                </Button>
                <p className="text-gray-500 text-xs mt-1">JPG, PNG ou GIF (máx. 5MB)</p>
            </div>
        </div>
    );
};

export default AvatarUpload;

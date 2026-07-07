import { supabaseAnonKey, supabaseUrl, supabase } from '@/integrations/supabase/client';
import { getAuthAccessToken } from '@/utils/auth-session-cache';
import { withTimeout } from '@/utils/promise-timeout';

function encodeStoragePath(path: string): string {
    return path.split('/').map(encodeURIComponent).join('/');
}

export function getStoragePublicUrl(bucket: string, path: string): string {
    return `${supabaseUrl}/storage/v1/object/public/${bucket}/${encodeStoragePath(path)}`;
}

export async function uploadStorageObjectRest(
    bucket: string,
    path: string,
    file: File,
    timeoutMs = 45_000,
): Promise<void> {
    const token = getAuthAccessToken();
    if (!token) {
        throw new Error('Sessão expirada. Faça login novamente.');
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(
            `${supabaseUrl}/storage/v1/object/${bucket}/${encodeStoragePath(path)}`,
            {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    apikey: supabaseAnonKey,
                    Authorization: `Bearer ${token}`,
                    'Content-Type': file.type || 'application/octet-stream',
                    'x-upsert': 'false',
                },
                body: file,
            },
        );

        if (!response.ok) {
            const err = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
            throw new Error(err?.message ?? err?.error ?? 'Falha no upload da imagem.');
        }
    } finally {
        window.clearTimeout(timer);
    }
}

export async function uploadEventImage(
    bucket: string,
    folderPath: string,
    userId: string,
    file: File,
): Promise<string> {
    const fileExt = file.name.split('.').pop() || 'jpg';
    const fileName = `${userId}-${Date.now()}.${fileExt}`;
    const filePath = `${folderPath}/${fileName}`;

    try {
        await uploadStorageObjectRest(bucket, filePath, file);
    } catch (restError) {
        console.warn('[uploadEventImage] REST falhou, tentando cliente Supabase:', restError);
        const { error: uploadError } = await withTimeout(
            supabase.storage.from(bucket).upload(filePath, file, { cacheControl: '3600', upsert: false }),
            20_000,
            { error: { message: 'timeout' } },
        );
        if (uploadError) {
            throw new Error(uploadError.message === 'timeout' ? 'Upload expirou. Tente novamente.' : uploadError.message);
        }
    }

    return getStoragePublicUrl(bucket, filePath);
}

export async function removeStorageObjectRest(
    bucket: string,
    path: string,
    timeoutMs = 15_000,
): Promise<void> {
    const token = getAuthAccessToken();
    if (!token) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
        await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${encodeStoragePath(path)}`, {
            method: 'DELETE',
            signal: controller.signal,
            headers: {
                apikey: supabaseAnonKey,
                Authorization: `Bearer ${token}`,
            },
        });
    } catch {
        /* best-effort cleanup */
    } finally {
        window.clearTimeout(timer);
    }
}

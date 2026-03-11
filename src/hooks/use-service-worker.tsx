import { useEffect } from 'react';

export const useServiceWorker = () => {
    useEffect(() => {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker
                .register('/sw.js')
                .then((registration) => {
                    console.log('Service Worker registrado com sucesso:', registration.scope);
                })
                .catch((error) => {
                    console.error('Erro ao registrar Service Worker:', error);
                });
        }
    }, []);
};


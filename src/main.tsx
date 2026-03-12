import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./globals.css";

// Registra Service Worker para PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register('/sw.js')
            .then((registration) => {
                console.log('Service Worker registrado:', registration.scope);
            })
            .catch((error) => {
                console.error('Erro ao registrar Service Worker:', error);
            });
    });
}

createRoot(document.getElementById("root")!).render(<App />);

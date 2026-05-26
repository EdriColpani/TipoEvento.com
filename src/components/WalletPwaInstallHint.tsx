import React, { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';
import { isStandalonePwa } from '@/utils/wallet-biometric';

const WalletPwaInstallHint: React.FC = () => {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const mobile = window.innerWidth < 768;
        const dismissed = sessionStorage.getItem('ef_wallet_pwa_hint_dismissed') === '1';
        setVisible(mobile && !isStandalonePwa() && !dismissed);
    }, []);

    if (!visible) return null;

    return (
        <div className="mb-6 rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4 text-sm text-gray-200">
            <div className="flex gap-3">
                <Smartphone className="h-5 w-5 text-cyan-400 shrink-0 mt-0.5" />
                <div>
                    <p className="font-medium text-cyan-300 mb-1">Instale a Carteira no celular</p>
                    <p className="text-gray-400 text-xs leading-relaxed">
                        Android: menu do Chrome → <strong>Instalar app</strong> ou <strong>Adicionar à tela inicial</strong>.
                        iPhone (Safari): Compartilhar → <strong>Adicionar à Tela de Início</strong>.
                    </p>
                    <button
                        type="button"
                        className="text-cyan-400 text-xs mt-2 underline"
                        onClick={() => {
                            sessionStorage.setItem('ef_wallet_pwa_hint_dismissed', '1');
                            setVisible(false);
                        }}
                    >
                        Entendi, não mostrar de novo
                    </button>
                </div>
            </div>
        </div>
    );
};

export default WalletPwaInstallHint;

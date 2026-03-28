import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, XCircle, Loader2, Key, QrCode, Scan, AlertTriangle, History, Search, Filter, Trash2, Volume2, VolumeX } from 'lucide-react';
import { showSuccess, showError } from '@/utils/toast';
import { format, isToday, isThisWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface ValidationResult {
    id: string;
    success: boolean;
    message: string;
    wristband_code: string;
    validation_type: string;
    validated_at: string;
    validated_by: string;
}

type HistoryFilter = 'all' | 'today' | 'week' | 'success' | 'error';

const MAX_HISTORY_ITEMS = 100;

/** Mesma aba: reutiliza “liberado” se a chave não mudou. Fechar aba exige validar de novo. */
const SESSION_VERIFIED_KEY = 'validator_verified_api_key';

// Funções para gerenciar histórico no localStorage
const saveToHistory = (result: ValidationResult) => {
    try {
        const history = getHistory();
        const newHistory = [result, ...history].slice(0, MAX_HISTORY_ITEMS);
        localStorage.setItem('validator_history', JSON.stringify(newHistory));
    } catch (error) {
        console.error('Erro ao salvar histórico:', error);
    }
};

const getHistory = (): ValidationResult[] => {
    try {
        const stored = localStorage.getItem('validator_history');
        return stored ? JSON.parse(stored) : [];
    } catch (error) {
        console.error('Erro ao carregar histórico:', error);
        return [];
    }
};

const clearHistory = () => {
    try {
        localStorage.removeItem('validator_history');
    } catch (error) {
        console.error('Erro ao limpar histórico:', error);
    }
};

// Função para tocar som de feedback
const playSound = (type: 'success' | 'error') => {
    try {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        if (type === 'success') {
            oscillator.frequency.value = 800;
            oscillator.type = 'sine';
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.3);
        } else {
            oscillator.frequency.value = 400;
            oscillator.type = 'sawtooth';
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.2);
        }
    } catch (error) {
        // Silenciosamente falha se AudioContext não estiver disponível
        console.debug('Audio não disponível:', error);
    }
};

const TicketValidator: React.FC = () => {
    const [apiKey, setApiKey] = useState<string>('');
    const [wristbandCode, setWristbandCode] = useState<string>('');
    const [validationType, setValidationType] = useState<'entry' | 'exit'>('entry');
    const [isValidating, setIsValidating] = useState(false);
    const [lastResult, setLastResult] = useState<ValidationResult | null>(null);
    const [isScanning, setIsScanning] = useState(false);
    const [history, setHistory] = useState<ValidationResult[]>([]);
    const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
    const [historySearch, setHistorySearch] = useState<string>('');
    const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
        const stored = localStorage.getItem('validator_sound_enabled');
        return stored ? stored === 'true' : true;
    });
    const [keyVerified, setKeyVerified] = useState(false);
    const [keyVerifying, setKeyVerifying] = useState(false);
    const [verifiedEventTitle, setVerifiedEventTitle] = useState<string | null>(null);

    const qrCodeScannerRef = useRef<Html5Qrcode | null>(null);
    const scannerContainerRef = useRef<HTMLDivElement>(null);

    // Carrega API key do localStorage; restaura “liberado” na sessão se for a mesma chave
    useEffect(() => {
        const storedApiKey = localStorage.getItem('validator_api_key');
        if (storedApiKey) {
            setApiKey(storedApiKey);
        }
    }, []);

    useEffect(() => {
        const k = apiKey.trim();
        const sessionOk = sessionStorage.getItem(SESSION_VERIFIED_KEY);
        if (k.length === 8 && sessionOk === k) {
            setKeyVerified(true);
        } else {
            setKeyVerified(false);
            setVerifiedEventTitle(null);
        }
    }, [apiKey]);

    // Salva API key no localStorage quando mudar
    useEffect(() => {
        if (apiKey) {
            localStorage.setItem('validator_api_key', apiKey);
        }
    }, [apiKey]);

    // Carrega histórico ao montar
    useEffect(() => {
        setHistory(getHistory());
    }, []);

    // Salva preferência de som
    useEffect(() => {
        localStorage.setItem('validator_sound_enabled', String(soundEnabled));
    }, [soundEnabled]);

    const verifyAccessKey = async () => {
        const k = apiKey.trim();
        if (k.length !== 8) {
            showError('Digite os 8 caracteres da chave.');
            return;
        }

        setKeyVerifying(true);
        try {
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
            const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
            if (!supabaseUrl || !anonKey) {
                showError('Configuração do app incompleta (URL/anon).');
                return;
            }

            const response = await fetch(`${supabaseUrl}/functions/v1/validate-ticket`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${anonKey}`,
                    apikey: anonKey,
                    'x-api-key': k,
                },
                body: JSON.stringify({ verify_key_only: true }),
            });

            const raw = (await response.json()) as {
                success?: boolean;
                message?: string;
                error?: string;
                event_title?: string | null;
            };

            if (response.ok && raw.success) {
                sessionStorage.setItem(SESSION_VERIFIED_KEY, k);
                setKeyVerified(true);
                setVerifiedEventTitle(raw.event_title ?? null);
                showSuccess(raw.message || 'Chave liberada. Agora você pode validar ingressos.');
            } else {
                sessionStorage.removeItem(SESSION_VERIFIED_KEY);
                setKeyVerified(false);
                setVerifiedEventTitle(null);
                showError(raw.error || raw.message || 'Chave inválida, inativa ou expirada.');
            }
        } catch (e: unknown) {
            sessionStorage.removeItem(SESSION_VERIFIED_KEY);
            setKeyVerified(false);
            setVerifiedEventTitle(null);
            const msg = e instanceof Error ? e.message : 'Erro ao verificar a chave.';
            showError(msg);
        } finally {
            setKeyVerifying(false);
        }
    };

    const validateTicket = async (code: string) => {
        if (!keyVerified) {
            showError('Toque em Validar ao lado da chave antes de validar o ingresso.');
            return;
        }
        if (!apiKey.trim()) {
            showError('Por favor, informe a chave de acesso.');
            return;
        }

        if (!code.trim()) {
            showError('Por favor, informe o código do ingresso.');
            return;
        }

        setIsValidating(true);
        setLastResult(null);

        try {
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
            const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
            if (!supabaseUrl || !anonKey) {
                showError('Configuração do app incompleta (URL/anon).');
                setIsValidating(false);
                return;
            }
            // Gateway Supabase exige Authorization Bearer (anon); x-api-key é a chave do operador (validação).
            const response = await fetch(`${supabaseUrl}/functions/v1/validate-ticket`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${anonKey}`,
                    apikey: anonKey,
                    'x-api-key': apiKey.trim(),
                },
                body: JSON.stringify({
                    wristband_code: code.trim(),
                    validation_type: validationType,
                }),
            });

            const raw = await response.json();
            const result: ValidationResult = {
                ...(typeof raw === 'object' && raw !== null ? raw : {}),
                message:
                    (raw as { message?: string })?.message ||
                    (raw as { error?: string })?.error ||
                    (response.ok ? 'OK' : 'Falha na validação'),
                success: Boolean((raw as { success?: boolean }).success),
                wristband_code: (raw as { wristband_code?: string }).wristband_code ?? code.trim(),
                validation_type: (raw as { validation_type?: string }).validation_type ?? validationType,
                validated_at: (raw as { validated_at?: string }).validated_at,
                validated_by: (raw as { validated_by?: string }).validated_by,
            } as ValidationResult;

            // Adiciona ID e timestamp se não vier do servidor
            const fullResult: ValidationResult = {
                ...result,
                id: result.id || `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                validated_at: result.validated_at || new Date().toISOString(),
                validated_by: result.validated_by || 'Sistema',
            };

            if (fullResult.success) {
                showSuccess(fullResult.message);
                setWristbandCode(''); // Limpa o campo após validação bem-sucedida
                if (soundEnabled) playSound('success');
            } else {
                showError(fullResult.message);
                if (soundEnabled) playSound('error');
            }

            setLastResult(fullResult);
            saveToHistory(fullResult);
            setHistory(getHistory());

        } catch (error: any) {
            const errorMessage = error.message || 'Erro ao validar ingresso. Verifique sua conexão.';
            showError(errorMessage);
            if (soundEnabled) playSound('error');
            
            const errorResult: ValidationResult = {
                id: `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                success: false,
                message: errorMessage,
                wristband_code: code,
                validation_type: validationType,
                validated_at: new Date().toISOString(),
                validated_by: 'Sistema',
            };
            
            setLastResult(errorResult);
            saveToHistory(errorResult);
            setHistory(getHistory());
        } finally {
            setIsValidating(false);
        }
    };

    const handleManualSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        validateTicket(wristbandCode);
    };

    const QR_READER_ID = 'validator-qr-reader';

    const handleScanQRCode = async () => {
        if (!keyVerified) {
            showError('Toque em Validar ao lado da chave antes de escanear.');
            return;
        }
        if (!apiKey.trim()) {
            showError('Por favor, informe a chave de acesso antes de escanear.');
            return;
        }

        if (qrCodeScannerRef.current) {
            await stopScanning();
        }

        setIsScanning(true);
        // Container precisa existir no DOM antes do Html5Qrcode (não montar o div só após isScanning)
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        const el = document.getElementById(QR_READER_ID);
        if (!el) {
            showError('Erro ao inicializar scanner. Atualize a página e tente de novo.');
            setIsScanning(false);
            return;
        }

        try {
            const html5QrCode = new Html5Qrcode(QR_READER_ID);
            qrCodeScannerRef.current = html5QrCode;

            const onDecode = (decodedText: string) => {
                const code = decodedText.trim();
                html5QrCode.stop().then(() => {
                    setIsScanning(false);
                    qrCodeScannerRef.current = null;
                    const normalized = /^[0-9a-f-]{36}$/i.test(code) ? code : code.toUpperCase();
                    setWristbandCode(normalized);
                    setTimeout(() => validateTicket(normalized), 300);
                }).catch(() => setIsScanning(false));
            };

            const config = { fps: 10, qrbox: { width: 250, height: 250 } as { width: number; height: number } };

            try {
                await html5QrCode.start({ facingMode: 'environment' }, config, onDecode, () => {});
            } catch {
                await html5QrCode.start({ facingMode: 'user' }, config, onDecode, () => {});
            }
        } catch (error: unknown) {
            console.error('Erro ao iniciar scanner:', error);
            const msg =
                error instanceof Error ? error.message : String(error);
            showError(
                msg.includes('Permission') || msg.includes('NotAllowed')
                    ? 'Permissão da câmera negada. Permita o acesso nas configurações do navegador.'
                    : 'Não foi possível abrir a câmera. Use HTTPS, permita a câmera ou digite o código manualmente.',
            );
            setIsScanning(false);
            qrCodeScannerRef.current = null;
        }
    };

    const stopScanning = async () => {
        if (qrCodeScannerRef.current) {
            try {
                await qrCodeScannerRef.current.stop();
                await qrCodeScannerRef.current.clear();
            } catch (error) {
                console.error('Erro ao parar scanner:', error);
            }
            qrCodeScannerRef.current = null;
        }
        setIsScanning(false);
    };

    // Limpa o scanner ao desmontar
    useEffect(() => {
        return () => {
            if (qrCodeScannerRef.current) {
                qrCodeScannerRef.current.stop().catch(() => {});
                qrCodeScannerRef.current.clear().catch(() => {});
            }
        };
    }, []);

    // Filtra histórico
    const filteredHistory = history.filter(item => {
        // Filtro de busca
        if (historySearch.trim()) {
            const searchLower = historySearch.toLowerCase();
            if (!item.wristband_code.toLowerCase().includes(searchLower) &&
                !item.message.toLowerCase().includes(searchLower)) {
                return false;
            }
        }

        // Filtros de data/status
        switch (historyFilter) {
            case 'today':
                return isToday(new Date(item.validated_at));
            case 'week':
                return isThisWeek(new Date(item.validated_at));
            case 'success':
                return item.success;
            case 'error':
                return !item.success;
            default:
                return true;
        }
    });

    const handleClearHistory = () => {
        if (confirm('Tem certeza que deseja limpar todo o histórico?')) {
            clearHistory();
            setHistory([]);
            showSuccess('Histórico limpo com sucesso!');
        }
    };

    return (
        <div className="min-h-screen bg-black text-white p-4">
            <div className="max-w-2xl mx-auto">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="flex items-center justify-center mb-4">
                        <QrCode className="h-12 w-12 text-yellow-500 mr-3" />
                        <h1 className="text-3xl font-serif text-yellow-500">Validador de Ingressos</h1>
                    </div>
                    <p className="text-gray-400">Valide ingressos de forma rápida e segura</p>
                </div>

                {/* Card de Configuração da API Key */}
                <Card className="bg-black border border-yellow-500/30 rounded-2xl mb-6">
                    <CardHeader>
                        <CardTitle className="text-white flex items-center justify-between">
                            <div className="flex items-center">
                                <Key className="h-5 w-5 mr-2 text-yellow-500" />
                                Chave de Acesso
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setSoundEnabled(!soundEnabled)}
                                className="text-yellow-500 hover:text-yellow-400"
                                title={soundEnabled ? 'Desativar som' : 'Ativar som'}
                            >
                                {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                            </Button>
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex flex-col sm:flex-row gap-2 sm:items-stretch">
                            <Input
                                type="text"
                                value={apiKey}
                                onChange={(e) => {
                                    const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
                                    setApiKey(value);
                                    if (value.length === 8) {
                                        localStorage.setItem('validator_api_key', value);
                                    }
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        void verifyAccessKey();
                                    }
                                }}
                                placeholder="Digite a chave de 8 caracteres (ex: A7K9M2X1)"
                                className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 text-center text-2xl font-mono tracking-widest sm:flex-1"
                                maxLength={8}
                                autoFocus
                                disabled={keyVerifying}
                                aria-label="Chave de acesso"
                            />
                            <Button
                                type="button"
                                onClick={() => void verifyAccessKey()}
                                disabled={keyVerifying || apiKey.trim().length !== 8}
                                className="shrink-0 bg-yellow-500 text-black hover:bg-yellow-600 disabled:opacity-50 sm:min-w-[120px]"
                            >
                                {keyVerifying ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Verificando
                                    </>
                                ) : (
                                    <>
                                        <CheckCircle className="mr-2 h-4 w-4" />
                                        Validar
                                    </>
                                )}
                            </Button>
                        </div>
                        <p className="text-xs mt-2 text-center">
                            {keyVerified ? (
                                <span className="text-green-400">
                                    ✓ Chave confirmada
                                    {verifiedEventTitle ? ` · ${verifiedEventTitle}` : ''}. Agora valide os ingressos abaixo.
                                </span>
                            ) : apiKey.length < 8 ? (
                                <span className="text-gray-400">
                                    Digite {8 - apiKey.length} caractere(s) restante(s), depois toque em Validar.
                                </span>
                            ) : (
                                <span className="text-yellow-500/90">
                                    Toque em <strong className="text-yellow-400">Validar</strong> para liberar entrada/saída e leitura do ingresso.
                                </span>
                            )}
                        </p>
                    </CardContent>
                </Card>

                {/* Card de Validação */}
                <Card
                    className={`bg-black border border-yellow-500/30 rounded-2xl mb-6 transition-opacity ${
                        !keyVerified ? 'opacity-45' : ''
                    }`}
                >
                    <CardHeader>
                        <CardTitle className="text-white flex items-center">
                            <Scan className="h-5 w-5 mr-2 text-yellow-500" />
                            Validar Ingresso
                        </CardTitle>
                        {!keyVerified && (
                            <p className="text-xs text-gray-500 font-normal pt-1">
                                Confirme a chave de acesso acima para habilitar esta área.
                            </p>
                        )}
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* Tipo de Validação */}
                        <div className="flex space-x-4">
                            <Button
                                type="button"
                                variant={validationType === 'entry' ? 'default' : 'outline'}
                                onClick={() => setValidationType('entry')}
                                disabled={!keyVerified}
                                className={`flex-1 ${
                                    validationType === 'entry'
                                        ? 'bg-green-500 text-white hover:bg-green-600'
                                        : 'bg-black/60 border-yellow-500/30 text-yellow-500'
                                }`}
                            >
                                Entrada
                            </Button>
                            <Button
                                type="button"
                                variant={validationType === 'exit' ? 'default' : 'outline'}
                                onClick={() => setValidationType('exit')}
                                disabled={!keyVerified}
                                className={`flex-1 ${
                                    validationType === 'exit'
                                        ? 'bg-red-500 text-white hover:bg-red-600'
                                        : 'bg-black/60 border-yellow-500/30 text-yellow-500'
                                }`}
                            >
                                Saída
                            </Button>
                        </div>

                        {/* Campo de Código */}
                        <form onSubmit={handleManualSubmit} className="space-y-4">
                            <Input
                                type="text"
                                value={wristbandCode}
                                onChange={(e) => setWristbandCode(e.target.value.toUpperCase())}
                                placeholder="Digite ou escaneie o código do ingresso"
                                className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 text-center text-lg font-mono"
                                autoFocus={keyVerified}
                                disabled={!keyVerified || isValidating || isScanning}
                                aria-disabled={!keyVerified}
                            />

                            {/* Botões de Ação */}
                            <div className="flex space-x-4">
                                <Button
                                    type="submit"
                                    disabled={
                                        !keyVerified ||
                                        isValidating ||
                                        !wristbandCode.trim() ||
                                        !apiKey.trim() ||
                                        isScanning
                                    }
                                    className="flex-1 bg-yellow-500 text-black hover:bg-yellow-600 disabled:opacity-50"
                                >
                                    {isValidating ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Validando...
                                        </>
                                    ) : (
                                        <>
                                            <CheckCircle className="mr-2 h-4 w-4" />
                                            Validar ingresso
                                        </>
                                    )}
                                </Button>
                                {!isScanning ? (
                                    <Button
                                        type="button"
                                        onClick={handleScanQRCode}
                                        disabled={!keyVerified || !apiKey.trim() || isValidating}
                                        className="bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
                                    >
                                        <QrCode className="mr-2 h-4 w-4" />
                                        Escanear QR
                                    </Button>
                                ) : (
                                    <Button
                                        type="button"
                                        onClick={stopScanning}
                                        className="bg-red-500 text-white hover:bg-red-600"
                                    >
                                        <XCircle className="mr-2 h-4 w-4" />
                                        Parar
                                    </Button>
                                )}
                            </div>
                        </form>

                        {/* Sempre no DOM: Html5Qrcode falha se o elemento for montado no mesmo clique */}
                        <div className={isScanning ? 'mt-4' : 'sr-only'} aria-hidden={!isScanning}>
                            <div
                                id="validator-qr-reader"
                                ref={scannerContainerRef}
                                className="relative min-h-[260px] w-full bg-black rounded-lg overflow-hidden"
                            />
                            {isScanning && (
                                <p className="text-center text-gray-400 text-sm mt-2">
                                    Aponte a câmera para o QR Code do ingresso
                                </p>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Resultado da Última Validação */}
                {lastResult && (
                    <Card className={`bg-black border rounded-2xl mb-6 ${
                        lastResult.success
                            ? 'border-green-500/50'
                            : 'border-red-500/50'
                    }`}>
                        <CardContent className="pt-6">
                            <div className="flex items-start space-x-4">
                                {lastResult.success ? (
                                    <CheckCircle className="h-8 w-8 text-green-500 flex-shrink-0 mt-1" />
                                ) : (
                                    <XCircle className="h-8 w-8 text-red-500 flex-shrink-0 mt-1" />
                                )}
                                <div className="flex-1">
                                    <div className={`text-lg font-semibold mb-2 ${
                                        lastResult.success ? 'text-green-400' : 'text-red-400'
                                    }`}>
                                        {lastResult.success ? 'Validação Bem-Sucedida' : 'Validação Falhou'}
                                    </div>
                                    <div className="text-sm text-gray-300 space-y-1">
                                        <p><strong>Mensagem:</strong> {lastResult.message}</p>
                                        <p><strong>Código:</strong> <span className="font-mono text-yellow-500">{lastResult.wristband_code}</span></p>
                                        <p><strong>Tipo:</strong> {lastResult.validation_type === 'entry' ? 'Entrada' : 'Saída'}</p>
                                        <p><strong>Validado por:</strong> {lastResult.validated_by}</p>
                                        <p><strong>Data/Hora:</strong> {format(new Date(lastResult.validated_at), 'dd/MM/yyyy HH:mm:ss', { locale: ptBR })}</p>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Histórico de Validações */}
                <Card className="bg-black border border-yellow-500/30 rounded-2xl mb-6">
                    <CardHeader>
                        <CardTitle className="text-white flex items-center justify-between">
                            <div className="flex items-center">
                                <History className="h-5 w-5 mr-2 text-yellow-500" />
                                Histórico de Validações
                            </div>
                            {history.length > 0 && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleClearHistory}
                                    className="text-red-500 hover:text-red-400"
                                    title="Limpar histórico"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            )}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* Filtros e Busca */}
                        <div className="flex flex-col sm:flex-row gap-2">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <Input
                                    type="text"
                                    value={historySearch}
                                    onChange={(e) => setHistorySearch(e.target.value)}
                                    placeholder="Buscar por código ou mensagem..."
                                    className="bg-black/60 border-yellow-500/30 text-white pl-10"
                                />
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    variant={historyFilter === 'all' ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => setHistoryFilter('all')}
                                    className={historyFilter === 'all' ? 'bg-yellow-500 text-black' : ''}
                                >
                                    Todos
                                </Button>
                                <Button
                                    variant={historyFilter === 'today' ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => setHistoryFilter('today')}
                                    className={historyFilter === 'today' ? 'bg-yellow-500 text-black' : ''}
                                >
                                    Hoje
                                </Button>
                                <Button
                                    variant={historyFilter === 'success' ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => setHistoryFilter('success')}
                                    className={historyFilter === 'success' ? 'bg-green-500 text-white' : ''}
                                >
                                    ✅
                                </Button>
                                <Button
                                    variant={historyFilter === 'error' ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => setHistoryFilter('error')}
                                    className={historyFilter === 'error' ? 'bg-red-500 text-white' : ''}
                                >
                                    ❌
                                </Button>
                            </div>
                        </div>

                        {/* Lista de Histórico */}
                        <div className="max-h-96 overflow-y-auto space-y-2">
                            {filteredHistory.length === 0 ? (
                                <p className="text-center text-gray-500 py-8">
                                    {history.length === 0 
                                        ? 'Nenhuma validação realizada ainda.'
                                        : 'Nenhum resultado encontrado com os filtros selecionados.'}
                                </p>
                            ) : (
                                filteredHistory.map((item) => (
                                    <div
                                        key={item.id}
                                        className={`p-3 rounded-lg border ${
                                            item.success
                                                ? 'bg-green-500/10 border-green-500/30'
                                                : 'bg-red-500/10 border-red-500/30'
                                        }`}
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-1">
                                                    {item.success ? (
                                                        <CheckCircle className="h-4 w-4 text-green-500" />
                                                    ) : (
                                                        <XCircle className="h-4 w-4 text-red-500" />
                                                    )}
                                                    <span className="font-mono text-sm text-yellow-500">
                                                        {item.wristband_code}
                                                    </span>
                                                    <span className={`text-xs px-2 py-0.5 rounded ${
                                                        item.validation_type === 'entry'
                                                            ? 'bg-green-500/20 text-green-400'
                                                            : 'bg-red-500/20 text-red-400'
                                                    }`}>
                                                        {item.validation_type === 'entry' ? 'Entrada' : 'Saída'}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-gray-400 mb-1">{item.message}</p>
                                                <p className="text-xs text-gray-500">
                                                    {format(new Date(item.validated_at), 'dd/MM/yyyy HH:mm:ss', { locale: ptBR })}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Instruções */}
                <Card className="bg-black/40 border border-yellow-500/20 rounded-2xl">
                    <CardContent className="pt-6">
                        <div className="flex items-start space-x-3">
                            <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                            <div className="text-sm text-gray-400 space-y-2">
                                <p><strong className="text-yellow-500">Instruções:</strong></p>
                                <ul className="list-disc list-inside space-y-1 ml-2">
                                    <li>Digite a chave de 8 caracteres e toque em <strong className="text-yellow-500">Validar</strong></li>
                                    <li>Depois escolha &quot;Entrada&quot; ou &quot;Saída&quot;</li>
                                    <li>Digite o código do ingresso ou use &quot;Escanear QR&quot;</li>
                                    <li>O resultado aparece logo abaixo; o histórico fica salvo neste aparelho</li>
                                </ul>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

export default TicketValidator;

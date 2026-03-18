import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { showError, showSuccess } from '@/utils/toast';
import { Loader2 } from 'lucide-react';

const UF_LIST = [
    'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

interface EventInfo {
    id: string;
    title: string;
    date: string;
    time: string;
    location: string;
    is_paid: boolean;
    banner_image_url?: string | null;
}

const formatCPF = (value: string) => {
    const clean = value.replace(/\D/g, '');
    return clean
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d{1,2})/, '$1-$2')
        .replace(/(-\d{2})\d+?$/, '$1');
};

const validateCPF = (cpf: string): boolean => {
    const clean = cpf.replace(/\D/g, '');
    if (clean.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(clean)) return false;
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += parseInt(clean.charAt(i)) * (10 - i);
    let digit = 11 - (sum % 11);
    if (digit >= 10) digit = 0;
    if (digit !== parseInt(clean.charAt(9))) return false;
    sum = 0;
    for (let i = 0; i < 10; i++) sum += parseInt(clean.charAt(i)) * (11 - i);
    digit = 11 - (sum % 11);
    if (digit >= 10) digit = 0;
    return digit === parseInt(clean.charAt(10));
};

/** Máscara (XX) XXXXX-XXXX ou (XX) XXXX-XXXX conforme dígitos */
const formatPhone = (value: string): string => {
    const clean = value.replace(/\D/g, '').slice(0, 11);
    if (clean.length === 0) return '';
    if (clean.length <= 2) return `(${clean}`;
    if (clean.length <= 7) return `(${clean.slice(0, 2)}) ${clean.slice(2)}`;
    return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7)}`;
};

const EventInscriptionPage: React.FC = () => {
    const { eventId } = useParams<{ eventId: string }>();
    const navigate = useNavigate();
    const [event, setEvent] = useState<EventInfo | null>(null);
    const [loadingEvent, setLoadingEvent] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [cities, setCities] = useState<{ id: number; nome: string }[]>([]);
    const [loadingCities, setLoadingCities] = useState(false);
    const [form, setForm] = useState({
        full_name: '',
        cpf: '',
        age: '',
        street: '',
        number: '',
        neighborhood: '',
        complement: '',
        city: '',
        state: '',
        phone: '',
        email: '',
    });

    useEffect(() => {
        if (!eventId) {
            setLoadingEvent(false);
            return;
        }
        const fetchEvent = async () => {
            const { data, error } = await supabase
                .from('events')
                .select('id, title, date, time, location, is_paid, banner_image_url')
                .eq('id', eventId)
                .single();
            if (error || !data) {
                setEvent(null);
            } else {
                setEvent(data as EventInfo);
            }
            setLoadingEvent(false);
        };
        fetchEvent();
    }, [eventId]);

    useEffect(() => {
        if (!form.state) {
            setCities([]);
            return;
        }
        let cancelled = false;
        setLoadingCities(true);
        setCities([]);
        fetch(
            `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${form.state}/municipios`,
        )
            .then((res) => res.json())
            .then((data: { id: number; nome: string }[]) => {
                if (!cancelled && Array.isArray(data)) {
                    setCities(
                        [...data].sort((a, b) =>
                            a.nome.localeCompare(b.nome, 'pt-BR'),
                        ),
                    );
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setCities([]);
                    showError('Não foi possível carregar as cidades. Tente outro estado ou digite a cidade manualmente abaixo.');
                }
            })
            .finally(() => {
                if (!cancelled) setLoadingCities(false);
            });
        return () => {
            cancelled = true;
        };
    }, [form.state]);

    const handleChange = (field: string, value: string) => {
        if (field === 'cpf') value = formatCPF(value);
        if (field === 'phone') value = formatPhone(value);
        if (field === 'age' && value !== '' && !/^\d*$/.test(value)) return;
        if (field === 'state') {
            setForm((prev) => ({ ...prev, state: value, city: '' }));
            if (errors.state) setErrors((prev) => ({ ...prev, state: '' }));
            if (errors.city) setErrors((prev) => ({ ...prev, city: '' }));
            return;
        }
        setForm((prev) => ({ ...prev, [field]: value }));
        if (errors[field]) setErrors((prev) => ({ ...prev, [field]: '' }));
    };

    const validate = (): boolean => {
        const e: Record<string, string> = {};
        if (!form.full_name.trim()) e.full_name = 'Nome completo é obrigatório';
        if (!form.cpf.trim()) e.cpf = 'CPF é obrigatório';
        else if (!validateCPF(form.cpf)) e.cpf = 'CPF inválido';
        if (!form.age.trim()) e.age = 'Idade é obrigatória';
        else if (Number(form.age) < 1 || Number(form.age) > 120) e.age = 'Idade inválida';
        if (!form.street.trim()) e.street = 'Rua é obrigatória';
        if (!form.number.trim()) e.number = 'Número é obrigatório';
        if (!form.neighborhood.trim()) e.neighborhood = 'Bairro é obrigatório';
        if (!form.city.trim()) e.city = 'Cidade é obrigatória';
        if (!form.state.trim()) e.state = 'Estado é obrigatório';
        const phoneDigits = form.phone.replace(/\D/g, '');
        if (!phoneDigits) e.phone = 'Telefone é obrigatório';
        else if (phoneDigits.length < 10) e.phone = 'Telefone inválido (mín. 10 dígitos)';
        if (!form.email.trim()) e.email = 'E-mail é obrigatório';
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'E-mail inválido';
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!validate() || !eventId || !event || submitting) return;
        setSubmitting(true);
        const cpfClean = form.cpf.replace(/\D/g, '');

        try {
            const { data: rpcData, error: rpcError } = await supabase.rpc('register_free_event_with_wristband', {
                p_event_id: eventId,
                p_full_name: form.full_name.trim(),
                p_cpf: cpfClean,
                p_age: Number(form.age),
                p_street: form.street.trim(),
                p_number: form.number.trim(),
                p_neighborhood: form.neighborhood.trim(),
                p_complement: form.complement.trim() || '',
                p_city: form.city.trim(),
                p_state: form.state.trim(),
                p_phone: form.phone.replace(/\D/g, ''),
                p_email: form.email.trim().toLowerCase(),
            });

            if (rpcError) {
                console.warn('register_free_event_with_wristband:', rpcError);
                showError(rpcError.message || 'Erro ao inscrever.');
                setSubmitting(false);
                return;
            }

            const row = rpcData as { ok?: boolean; error?: string; qr_code?: string; wristband_code?: string } | null;
            if (!row?.ok) {
                const msg: Record<string, string> = {
                    cpf_taken: 'Já existe uma inscrição para este CPF neste evento.',
                    no_free_wristbands:
                        'Não há vagas com pulseira gratuita neste evento. Cadastre um lote com preço R$ 0,00 ou entre em contato com o organizador.',
                    event_not_free: 'Este evento não é gratuito.',
                    invalid_cpf: 'CPF inválido.',
                };
                showError(msg[row?.error || ''] || 'Não foi possível concluir a inscrição.');
                setSubmitting(false);
                return;
            }

            showSuccess('Inscrição realizada com sucesso!');
            navigate(`/events/${eventId}/inscricao/sucesso`, {
                state: {
                    qrCode: row.qr_code,
                    wristbandCode: row.wristband_code || '',
                    eventTitle: event.title,
                    eventDate: event.date,
                    eventTime: event.time,
                    eventLocation: event.location,
                    email: form.email.trim().toLowerCase(),
                },
            });
        } catch {
            showError('Erro inesperado. Tente novamente.');
        } finally {
            setSubmitting(false);
        }
    };

    if (loadingEvent) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
            </div>
        );
    }

    if (!eventId || !event) {
        return (
            <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-4">
                <h1 className="text-2xl font-serif text-yellow-500 mb-2">Evento não encontrado</h1>
                <Button onClick={() => navigate('/')} className="bg-yellow-500 text-black hover:bg-yellow-600 mt-4">
                    Voltar à Home
                </Button>
            </div>
        );
    }

    if (event.is_paid) {
        return (
            <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-4">
                <p className="text-gray-400 mb-4">Este evento é pago. Para comprar ingressos, acesse os detalhes do evento.</p>
                <Button onClick={() => navigate(`/events/${eventId}`)} className="bg-yellow-500 text-black hover:bg-yellow-600">
                    Ver detalhes do evento
                </Button>
            </div>
        );
    }

    const inputClass = 'bg-black/60 border-yellow-500/30 text-white min-h-[48px] text-base';
    const labelClass = 'block text-sm font-medium text-white mb-2';

    return (
        <div className="min-h-screen bg-black text-white">
            <div className="px-4 pt-6 md:pt-10">
                <div className="max-w-md md:max-w-2xl mx-auto">
                    {/* Banner do evento (não corta a imagem) */}
                    <div className="bg-black/60 border border-yellow-500/30 rounded-2xl overflow-hidden">
                        <div className="relative w-full bg-black">
                            {event.banner_image_url ? (
                                <img
                                    src={event.banner_image_url}
                                    alt={`Banner do evento ${event.title}`}
                                    className="w-full h-[140px] sm:h-[160px] md:h-[190px] object-contain"
                                    loading="eager"
                                />
                            ) : (
                                <div className="w-full h-[120px] sm:h-[140px] md:h-[160px]" />
                            )}
                            {/* faixa de informações */}
                            <div className="absolute left-0 right-0 bottom-0 bg-black/75 backdrop-blur-md border-t border-yellow-500/20 px-4 py-3">
                                <p className="text-xs text-yellow-500/90 font-semibold tracking-wide">Inscrição</p>
                                <h1 className="text-base sm:text-lg md:text-xl font-serif text-white font-bold leading-tight line-clamp-2">
                                    {event.title}
                                </h1>
                                <p className="text-gray-300 text-xs mt-1 line-clamp-2">
                                    {event.date} · {event.time}
                                    {event.location ? ` · ${event.location}` : ''}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="px-4 py-6 pb-10 md:py-10">
                <div className="max-w-md md:max-w-2xl mx-auto">
                    <Card className="bg-black/60 border border-yellow-500/30 rounded-2xl p-5 md:p-8">
                        <form onSubmit={handleSubmit} className="space-y-5">
                            <div>
                            <label className={labelClass}>Nome completo *</label>
                            <Input
                                value={form.full_name}
                                onChange={e => handleChange('full_name', e.target.value)}
                                className={inputClass}
                                placeholder="Seu nome completo"
                                inputMode="text"
                                autoComplete="name"
                            />
                            {errors.full_name && <p className="text-red-400 text-xs mt-1">{errors.full_name}</p>}
                            </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
                            <div>
                                <label className={labelClass}>CPF *</label>
                                <Input
                                    value={form.cpf}
                                    onChange={e => handleChange('cpf', e.target.value)}
                                    className={inputClass}
                                    placeholder="000.000.000-00"
                                    maxLength={14}
                                    inputMode="numeric"
                                />
                                {errors.cpf && <p className="text-red-400 text-xs mt-1">{errors.cpf}</p>}
                            </div>
                            <div>
                                <label className={labelClass}>Idade *</label>
                                <Input
                                    type="number"
                                    min={1}
                                    max={120}
                                    value={form.age}
                                    onChange={e => handleChange('age', e.target.value)}
                                    className={inputClass}
                                    placeholder="Idade"
                                    inputMode="numeric"
                                />
                                {errors.age && <p className="text-red-400 text-xs mt-1">{errors.age}</p>}
                            </div>
                        </div>
                        <div>
                            <label className={labelClass}>Rua *</label>
                            <Input
                                value={form.street}
                                onChange={e => handleChange('street', e.target.value)}
                                className={inputClass}
                                placeholder="Nome da rua"
                                autoComplete="street-address"
                            />
                            {errors.street && <p className="text-red-400 text-xs mt-1">{errors.street}</p>}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5">
                            <div>
                                <label className={labelClass}>Número *</label>
                                <Input
                                    value={form.number}
                                    onChange={e => handleChange('number', e.target.value)}
                                    className={inputClass}
                                    placeholder="Nº"
                                    inputMode="numeric"
                                />
                                {errors.number && <p className="text-red-400 text-xs mt-1">{errors.number}</p>}
                            </div>
                            <div>
                                <label className={labelClass}>Bairro *</label>
                                <Input
                                    value={form.neighborhood}
                                    onChange={e => handleChange('neighborhood', e.target.value)}
                                    className={inputClass}
                                    placeholder="Bairro"
                                    autoComplete="address-level2"
                                />
                                {errors.neighborhood && <p className="text-red-400 text-xs mt-1">{errors.neighborhood}</p>}
                            </div>
                            <div>
                                <label className={labelClass}>Complemento</label>
                                <Input
                                    value={form.complement}
                                    onChange={e => handleChange('complement', e.target.value)}
                                    className={inputClass}
                                    placeholder="Apto, bloco..."
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
                            <div>
                                <label className={labelClass}>Estado (UF) *</label>
                                <select
                                    value={form.state}
                                    onChange={(e) => handleChange('state', e.target.value)}
                                    className={`w-full rounded-md border ${inputClass} px-3 focus:outline-none focus:ring-2 focus:ring-yellow-500`}
                                >
                                    <option value="">Selecione o estado</option>
                                    {UF_LIST.map((uf) => (
                                        <option key={uf} value={uf}>
                                            {uf}
                                        </option>
                                    ))}
                                </select>
                                {errors.state && (
                                    <p className="text-red-400 text-xs mt-1">{errors.state}</p>
                                )}
                            </div>
                            <div>
                                <label className={labelClass}>Cidade *</label>
                                {!form.state ? (
                                    <p className={`${inputClass} flex items-center px-3 text-gray-500 text-sm border rounded-md`}>
                                        Selecione o estado para listar as cidades
                                    </p>
                                ) : loadingCities ? (
                                    <p className={`${inputClass} flex items-center gap-2 px-3 text-gray-400 text-sm border rounded-md`}>
                                        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                                        Carregando cidades…
                                    </p>
                                ) : cities.length > 0 ? (
                                    <select
                                        value={
                                            cities.some((c) => c.nome === form.city)
                                                ? form.city
                                                : ''
                                        }
                                        onChange={(e) =>
                                            handleChange('city', e.target.value)
                                        }
                                        className={`w-full rounded-md border ${inputClass} px-3 focus:outline-none focus:ring-2 focus:ring-yellow-500`}
                                    >
                                        <option value="">Selecione a cidade</option>
                                        {cities.map((c) => (
                                            <option key={c.id} value={c.nome}>
                                                {c.nome}
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <Input
                                        value={form.city}
                                        onChange={(e) =>
                                            handleChange('city', e.target.value)
                                        }
                                        className={inputClass}
                                        placeholder="Digite a cidade"
                                        autoComplete="address-level2"
                                    />
                                )}
                                {errors.city && (
                                    <p className="text-red-400 text-xs mt-1">{errors.city}</p>
                                )}
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
                            <div>
                                <label className={labelClass}>Telefone *</label>
                                <Input
                                    value={form.phone}
                                    onChange={e => handleChange('phone', e.target.value)}
                                    onBlur={() => form.phone && handleChange('phone', formatPhone(form.phone))}
                                    onPaste={(e) => {
                                        const pasted = (e.clipboardData?.getData('text') || '').replace(/\D/g, '');
                                        if (pasted) {
                                            e.preventDefault();
                                            handleChange('phone', pasted);
                                        }
                                    }}
                                    className={inputClass}
                                    placeholder="(00) 00000-0000"
                                    inputMode="tel"
                                    maxLength={16}
                                />
                                {errors.phone && <p className="text-red-400 text-xs mt-1">{errors.phone}</p>}
                            </div>
                            <div>
                                <label className={labelClass}>E-mail *</label>
                                <Input
                                    type="email"
                                    value={form.email}
                                    onChange={e => handleChange('email', e.target.value)}
                                    className={inputClass}
                                    placeholder="seu@email.com"
                                    inputMode="email"
                                    autoComplete="email"
                                />
                                {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
                            </div>
                        </div>
                        <div className="flex flex-col md:flex-row gap-3 pt-2 md:gap-4">
                            <Button
                                type="submit"
                                disabled={submitting}
                                className="bg-yellow-500 text-black hover:bg-yellow-600 min-h-[48px] text-base font-semibold w-full md:flex-1"
                            >
                                {submitting ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : 'Realizar inscrição'}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => navigate('/')}
                                className="border-yellow-500/50 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/20 hover:border-yellow-500 min-h-[48px] text-base w-full md:w-auto md:min-w-[120px]"
                            >
                                Cancelar
                            </Button>
                        </div>
                        </form>
                    </Card>
                </div>
            </div>
        </div>
    );
};

export default EventInscriptionPage;

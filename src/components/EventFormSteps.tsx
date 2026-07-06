import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ENTRY_QR_ALLOWED_TTLS, ENTRY_QR_TTL_LABELS } from '@/constants/entry-qr';
import CompanyEventCategoryField from '@/components/CompanyEventCategoryField';
import { normalizeContractContentForDisplay, looksLikeContractHtml, prepareContractContentForHtmlDisplay } from '@/utils/contractContent';
import { showSuccess, showError, showLoading, dismissToast } from '@/utils/toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, ImageOff, CalendarDays, ArrowLeft, Save, ArrowRight, Image, CheckSquare, FileText, XCircle, Plus, Ticket } from 'lucide-react';
import { format } from 'date-fns';
import { parseEventLocalDay } from '@/utils/format-event-date';
import { DatePicker } from '@/components/DatePicker';
import ImageUploadPicker from '@/components/ImageUploadPicker';
import { useManagerCompany } from '@/hooks/use-manager-company';
import { ensureGestorCompanyLinked } from '@/utils/ensureGestorCompany';
import { fetchManagerPrimaryCompanyId } from '@/utils/manager-scope';
import { useProfile } from '@/hooks/use-profile';
import { useAuthUserId } from '@/hooks/use-auth-user-id';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { useQueryClient, useQuery } from '@tanstack/react-query'; // Importando useQueryClient e useQuery
import {
    getContractTypesForBillingPlan,
    MANAGER_EVENT_CREATION_CONTRACT_TYPE,
} from '@/constants/event-contracts';
import { isCompanyBillingReady } from '@/constants/billing-plans';
import {
    companyAllowsTicketSales,
    DEFAULT_MIN_EVENT_TICKETS,
    isHybridPlan,
    isConsumptionOrLicensePlan,
    isListingOnlyCompanyPlan,
} from '@/utils/company-billing-rules';
import { validateMinBatchTicketSum } from '@/utils/min-event-tickets-validation';
import { parseBatchQuantity, isValidBatchQuantity, batchQuantityAsNumber } from '@/utils/batch-quantity';
import { useCompanyBilling } from '@/hooks/use-company-billing';
import { useContractScrollEnd } from '@/hooks/use-contract-scroll-end';
import ContractScrollHint from '@/components/ContractScrollHint';
import EventGrandePorteGuide from '@/components/EventGrandePorteGuide';
import EventLocationFormFields from '@/components/EventLocationFormFields';
import { resolveEventGeoOnSave } from '@/utils/google-maps';
import { cn } from '@/lib/utils';
import {
    getOrCreateClientSubmitId,
    persistManagerCreateEventDraftId,
    readManagerCreateEventDraftId,
} from '@/utils/manager-create-event-session';
import {
    MAX_EVENT_HIGHLIGHTS,
    parseHighlightsText,
    validateHighlightsText,
} from '@/utils/event-highlights';
import { useEventEditSalesGuard } from '@/hooks/use-event-edit-sales-guard';
import {
    batchesDifferFromSnapshot,
    salesGuardLockedMessage,
    snapshotBatchesForLock,
    turmasDifferFromSnapshot,
    type LockedBatchSnapshot,
    type LockedTurmaSnapshot,
} from '@/utils/event-edit-sales-guard';

interface EventContract {
    id: string;
    version: string;
    title: string;
    content: string;
    is_active: boolean;
    created_at: string;
    created_by: string | null;
    updated_at: string;
    contract_type?: string;
}

interface CommissionRange {
    id: string;
    min_tickets: number;
    max_tickets: number;
    percentage: number;
    active: boolean;
}

// Definição do esquema de validação do formulário
const eventFormSchema = z.object({
    title: z.string().min(3, "O título deve ter pelo menos 3 caracteres.").max(100, "O título não pode exceder 100 caracteres."),
    description: z.string().min(10, "A descrição deve ter pelo menos 10 caracteres.").max(1000, "A descrição não pode exceder 1000 caracteres."),
    /** Textarea: um destaque por linha (opcional). */
    highlights_text: z.string().max(2000, "Destaques: texto muito longo.").optional().default(''),
    date: z.date({ required_error: "A data do evento é obrigatória." }),
    // Deixamos o <input type=\"time\" garantir o formato HH:MM
    // Aqui só exigimos que o campo não esteja vazio
    time: z.string().min(1, "A hora do evento é obrigatória."),
    location: z.string().min(3, "O local deve ter pelo menos 3 caracteres.").max(100, "O local não pode exceder 100 caracteres."),
    address: z.string().min(5, "O endereço deve ter pelo menos 5 caracteres.").max(200, "O endereço não pode exceder 200 caracteres."),
    address_lat: z.number().nullable().optional(),
    address_lng: z.number().nullable().optional(),
    address_place_id: z.string().max(255).nullable().optional(),
    card_image_url: z.string().url("URL da imagem do card inválida."),
    exposure_card_image_url: z.string().url("URL da imagem de exposição inválida."),
    banner_image_url: z.string().url("URL da imagem do banner inválida."),
    min_age: z.string().regex(/^([0-9]|1[0-8])$/, "A idade mínima deve ser entre 0 e 18 anos."),
    category: z.string().min(1, "A categoria é obrigatória."),
    capacity: z.string().regex(/^[1-9]\d*$/, "A capacidade deve ser um número inteiro positivo."),
    duration: z.string().min(1, "A duração é obrigatória."),
    is_paid: z.boolean().default(false),
    /** Evento pago: permite validar ingresso impresso (QR fixo) além do QR dinâmico do app */
    allow_printed_tickets: z.boolean().default(false),
    entry_qr_ttl_seconds: z.preprocess(
        (val) => {
            const normalized = val === undefined || val === null || val === '' ? '90' : String(val);
            return normalized;
        },
        z.enum(['60', '90', '120']),
    ),
    validator_show_holder: z.boolean().default(true),
    credit_consumption_enabled: z.boolean().default(false),
    ticket_price: z.string().optional().refine(val => {
        if (val === undefined || val === '') return true; // Permite vazio se não for pago
        return /^[0-9]+([,.][0-9]{1,2})?$/.test(val.replace('.', '').replace(',', '.'));
    }, "Preço do ingresso inválido."),
    // Novo campo para o número de lotes (só validado quando evento for pago)
    num_batches: z.string().optional().refine(val => {
        if (val === undefined || val === '') return true; // Permite vazio
        return /^[1-9]\d*$/.test(val); // Deve ser um número inteiro positivo
    }, "Número de lotes deve ser um número inteiro positivo."),
    // Detalhes de cada lote: campos opcionais no schema; validação condicional em superRefine (só quando is_paid)
    batches: z.array(z.object({
        name: z.string().optional(),
        quantity: z.string().optional(),
        price: z.string().optional(),
        start_date: z.date().optional().nullable(),
        end_date: z.date().optional().nullable(),
    })).optional(),
    contractAccepted: z.boolean().default(false),
    contract_id: z.string().optional(), // Para armazenar o ID do contrato aceito
}).superRefine((data, ctx) => {
    const highlightsErr = validateHighlightsText(data.highlights_text);
    if (highlightsErr) {
        ctx.addIssue({ code: 'custom', message: highlightsErr, path: ['highlights_text'] });
    }
}).superRefine((data, ctx) => {
    // Só valida lotes quando o evento é pago; evento gratuito ignora batches
    if (!data.is_paid) return;
    if (!data.batches || data.batches.length === 0) {
        ctx.addIssue({ code: 'custom', message: 'Para eventos pagos, cadastre pelo menos um lote de ingressos.', path: ['batches'] });
        return;
    }
    data.batches.forEach((batch, i) => {
        if (!batch.name || !String(batch.name).trim()) ctx.addIssue({ code: 'custom', message: 'Nome do lote é obrigatório.', path: ['batches', i, 'name'] });
        const qtyNorm = parseBatchQuantity(batch.quantity);
        const qtyMax = 500_000;
        if (!isValidBatchQuantity(batch.quantity, qtyMax)) {
            ctx.addIssue({
                code: 'custom',
                message: qtyMax && qtyNorm && Number(qtyNorm) > qtyMax
                    ? `Quantidade máxima por lote: ${qtyMax.toLocaleString('pt-BR')}.`
                    : 'Quantidade deve ser um número inteiro positivo (ex.: 50000 ou 50.000).',
                path: ['batches', i, 'quantity'],
            });
        }
        const priceStr = batch.price ? String(batch.price).replace(/\./g, '').replace(',', '.') : '';
        if (!batch.price || !/^[0-9]+(\.[0-9]{1,2})?$/.test(priceStr)) ctx.addIssue({ code: 'custom', message: 'Preço inválido.', path: ['batches', i, 'price'] });
        if (!batch.start_date) ctx.addIssue({ code: 'custom', message: 'Data de início é obrigatória.', path: ['batches', i, 'start_date'] });
        if (!batch.end_date) ctx.addIssue({ code: 'custom', message: 'Data de término é obrigatória.', path: ['batches', i, 'end_date'] });
    });
});

type EventFormData = z.infer<typeof eventFormSchema>;

interface EventFormStepsProps {
    initialData?: EventFormData | null;
    eventId?: string;
    userId?: string | null; // Adicionar userId como prop opcional
    /** Se definido em criação (sem eventId), chamado após persistir lotes/turmas; não redireciona para a lista. */
    onCreateSuccess?: (newEventId: string) => void;
    /** ID do evento já criado nesta sessão (estado do pai). Sobrevive a remontagem do formulário — evita 2º INSERT. */
    draftPersistedEventId?: string | null;
    /** Enquanto o modal pós-criação está aberto, impede novo envio e cliques no form. */
    freezeFormAfterCreate?: boolean;
}

const EventFormSteps: React.FC<EventFormStepsProps> = ({
    initialData,
    eventId,
    userId: propUserId,
    onCreateSuccess,
    draftPersistedEventId,
    freezeFormAfterCreate,
}) => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [currentStep, setCurrentStep] = useState(1);
    const skipStepScrollRef = useRef(true);
    const formTopRef = useRef<HTMLDivElement>(null);
    const [isSaving, setIsSaving] = useState(false);
    /** Evita duplo INSERT/update: `isSaving` só atualiza no próximo render; clique duplo dispara dois submits no mesmo tick. */
    const submitInFlightRef = useRef(false);
    /** Após o 1º INSERT na página "criar evento", próximos "Salvar" fazem UPDATE (evita 2º registro no banco). Síncrono antes dos awaits dos lotes. */
    const createdEventIdRef = useRef<string | null>(null);

    useEffect(() => {
        if (eventId) {
            createdEventIdRef.current = null;
        }
    }, [eventId]);

    useEffect(() => {
        if (draftPersistedEventId) {
            createdEventIdRef.current = draftPersistedEventId;
        }
    }, [draftPersistedEventId]);

    const scrollFormToTop = useCallback(() => {
        formTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
    }, []);

    useLayoutEffect(() => {
        if (skipStepScrollRef.current) {
            skipStepScrollRef.current = false;
            return;
        }
        scrollFormToTop();
        const t = window.setTimeout(scrollFormToTop, 50);
        return () => window.clearTimeout(t);
    }, [currentStep, scrollFormToTop]);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const { userId: authUserId } = useAuthUserId();
    const userId = propUserId ?? authUserId ?? null;
    const [useTurmas, setUseTurmas] = useState(false);
    const [editPricingLoading, setEditPricingLoading] = useState(Boolean(eventId));
    const lockedBatchesRef = useRef<LockedBatchSnapshot[] | null>(null);
    const lockedTurmasRef = useRef<LockedTurmaSnapshot[] | null>(null);
    const lockedIsPaidRef = useRef<boolean | null>(null);
    const { data: salesGuard } = useEventEditSalesGuard(eventId);
    const ticketsLocked = Boolean(eventId && salesGuard?.has_sales);
    const [turmasDraft, setTurmasDraft] = useState<Array<{ id?: string; nome: string; capacity: string }>>([
        { nome: 'Turma 1', capacity: '50' },
        { nome: 'Turma 2', capacity: '50' },
    ]);
    const [originalTurmas, setOriginalTurmas] = useState<Array<{ id: string; nome: string; capacity: number }>>([]);

    const { profile, isLoading: isLoadingProfile } = useProfile(userId);
    const { company, isLoading: isLoadingCompany } = useManagerCompany(userId);
    const { billing: companyBilling, isLoading: isLoadingCompanyBilling } = useCompanyBilling(company?.id);
    const companyBillingReady = isCompanyBillingReady(companyBilling);
    // Plano vitrine: evento salvo com listing_only (sem venda de ingressos) — alinhado à matriz de permissões.
    const isListingPlan = isListingOnlyCompanyPlan(companyBilling?.billing_plan);
    const requiresPaidTickets = companyAllowsTicketSales(companyBilling?.billing_plan);
    const companyMinEventTickets = companyBilling?.min_event_tickets ?? DEFAULT_MIN_EVENT_TICKETS;
    const supportsCreditConsumption =
        isHybridPlan(companyBilling?.billing_plan) || isConsumptionOrLicensePlan(companyBilling?.billing_plan);

    const { data: activeContract, isLoading: isLoadingContract } = useQuery<EventContract | null>({ // Adicionado useQuery para buscar contrato
        queryKey: ['activeEventContract', MANAGER_EVENT_CREATION_CONTRACT_TYPE],
        queryFn: async () => {
            try {
                const contractTypes = getContractTypesForBillingPlan(MANAGER_EVENT_CREATION_CONTRACT_TYPE);
                let data: EventContract | null = null;

                for (const contractType of contractTypes) {
                    const { data: active, error } = await supabase
                        .from('event_contracts')
                        .select('*')
                        .eq('contract_type', contractType)
                        .eq('is_active', true)
                        .maybeSingle();

                    if (error?.code === '42501' || error?.message?.includes('permission') || error?.message?.includes('policy')) {
                        console.error('Erro de permissão ao buscar contrato (RLS):', error);
                        showError('Você não tem permissão para ler os contratos. Entre em contato com o administrador.');
                        return null;
                    }
                    if (error && error.code !== 'PGRST116' && error.code !== 'PGRST117') {
                        console.error('Error fetching active contract:', error);
                        showError('Erro ao carregar o contrato ativo: ' + error.message);
                        return null;
                    }
                    if (active) {
                        data = active as EventContract;
                        break;
                    }
                }

                if (!data) {
                    for (const contractType of contractTypes) {
                        const { data: latestData, error: latestError } = await supabase
                            .from('event_contracts')
                            .select('*')
                            .eq('contract_type', contractType)
                            .order('updated_at', { ascending: false })
                            .order('created_at', { ascending: false })
                            .limit(1)
                            .maybeSingle();

                        if (latestError?.code === '42501' || latestError?.message?.includes('permission')) {
                            showError('Você não tem permissão para ler os contratos. Entre em contato com o administrador.');
                            return null;
                        }
                        if (latestError && latestError.code !== 'PGRST116' && latestError.code !== 'PGRST117') {
                            console.error('Error fetching latest contract:', latestError);
                            showError('Erro ao carregar o contrato: ' + latestError.message);
                            return null;
                        }
                        if (latestData) {
                            data = latestData as EventContract;
                            if (!data.is_active) {
                                console.warn(
                                    '[EventFormSteps] Contrato de ingressos inativo; usando no fluxo. Ative em Admin → Contratos.',
                                    data.id,
                                );
                            }
                            break;
                        }
                    }
                }

                return data;
            } catch (err: unknown) {
                console.error('Erro inesperado ao buscar contrato:', err);
                showError(
                    'Erro inesperado ao carregar contrato: ' + (err instanceof Error ? err.message : 'Erro desconhecido'),
                );
                return null;
            }
        },
        enabled: !!userId, // Habilita a query apenas se userId existir
        staleTime: 1000 * 60 * 5,
        retry: 1, // Tenta uma vez em caso de erro
    });

    // Nova query para buscar as faixas de comissão ativas
    const { data: commissionRanges, isLoading: isLoadingCommissionRanges } = useQuery<CommissionRange[]>({
        queryKey: ['activeCommissionRanges'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('commission_ranges')
                .select('*')
                .eq('active', true)
                .order('min_tickets', { ascending: true });
            
            if (error) {
                console.error("Error fetching commission ranges:", error);
                showError("Erro ao carregar as faixas de comissão.");
                return [];
            }
            return data as CommissionRange[];
        },
        enabled: !!userId, // Habilita a query apenas se userId existir
        staleTime: 1000 * 60 * 5,
        retry: false,
    });

    const methods = useForm<EventFormData>({
        resolver: zodResolver(eventFormSchema),
        defaultValues: {
            title: initialData?.title || '',
            description: initialData?.description || '',
            highlights_text: initialData?.highlights_text ?? '',
            date: initialData?.date ?? undefined,
            time: initialData?.time || '',
            location: initialData?.location || '',
            address: initialData?.address || '',
            address_lat: initialData?.address_lat ?? null,
            address_lng: initialData?.address_lng ?? null,
            address_place_id: initialData?.address_place_id ?? null,
            card_image_url: initialData?.card_image_url || '',
            exposure_card_image_url: initialData?.exposure_card_image_url || '',
            banner_image_url: initialData?.banner_image_url || '',
            min_age: initialData?.min_age?.toString() || '',
            category: initialData?.category || '',
            capacity: initialData?.capacity?.toString() || '',
            duration: initialData?.duration || '',
            is_paid: initialData?.is_paid || false,
            allow_printed_tickets: initialData?.allow_printed_tickets ?? false,
            entry_qr_ttl_seconds: (['60', '90', '120'] as const).includes(
                String(initialData?.entry_qr_ttl_seconds ?? '90') as '60' | '90' | '120',
            )
                ? (String(initialData?.entry_qr_ttl_seconds) as '60' | '90' | '120')
                : '90',
            validator_show_holder: initialData?.validator_show_holder ?? true,
            credit_consumption_enabled: initialData?.credit_consumption_enabled ?? false,
            ticket_price: initialData?.ticket_price?.toString().replace('.', ',') || '',
            num_batches: initialData?.batches?.length.toString() || '1', // Default para 1 lote
            batches: initialData?.batches?.map((batch) => ({
                ...batch,
                price: batch.price.toString().replace('.', ','), // Formata o preço para BR
                start_date:
                    batch.start_date instanceof Date
                        ? batch.start_date
                        : parseEventLocalDay(String(batch.start_date)) ?? undefined,
                end_date:
                    batch.end_date instanceof Date
                        ? batch.end_date
                        : parseEventLocalDay(String(batch.end_date)) ?? undefined,
            })) || [
                { name: 'Lote 1', quantity: '', price: '', start_date: undefined, end_date: undefined } // Lote inicial
            ],
            contractAccepted: false,
            contract_id: initialData?.contract_id || undefined, // Inicializa com o contrato existente
        },
    });

    const { handleSubmit, control, setValue, watch, formState: { errors } } = methods;

    const isPaid = watch('is_paid');
    const showPaidPricing = isPaid || requiresPaidTickets;
    const numBatches = parseInt(watch('num_batches') || '0');
    const batches = watch('batches');

    // TODOS OS HOOKS DEVEM SER CHAMADOS ANTES DE QUALQUER RETURN CONDICIONAL
    // Atualiza o número de lotes dinamicamente
    useEffect(() => {
        if (!isPaid || editPricingLoading || ticketsLocked) return;
        const currentBatches = methods.getValues('batches') || [];
        if (numBatches > currentBatches.length) {
                // Adiciona novos lotes
                const newBatches = Array.from({ length: numBatches - currentBatches.length }, (_, i) => ({
                    name: `Lote ${currentBatches.length + i + 1}`,
                    quantity: '',
                    price: '',
                    start_date: undefined,
                    end_date: undefined,
                }));
                setValue('batches', [...currentBatches, ...newBatches]);
        } else if (numBatches < currentBatches.length) {
            setValue('batches', currentBatches.slice(0, numBatches));
        }
    }, [numBatches, isPaid, editPricingLoading, ticketsLocked, methods, setValue]);

    // Se estiver editando um evento e já tiver um contract_id, marcar como aceito
    useEffect(() => {
        if (eventId && initialData?.contract_id && activeContract) {
            setValue('contractAccepted', true);
            setValue('contract_id', activeContract.id);
        }
    }, [eventId, initialData, activeContract, setValue]);

    // Plano já aceito na empresa: não exige passo de contrato no formulário do evento
    useEffect(() => {
        if (companyBillingReady && companyBilling?.billing_contract_id) {
            setValue('contractAccepted', true);
            setValue('contract_id', companyBilling.billing_contract_id);
        }
    }, [companyBillingReady, companyBilling, setValue]);

    const showContractStep = Boolean(activeContract) && !companyBillingReady;

    const contractScrollKey =
        activeContract && showContractStep
            ? `${activeContract.id}-${activeContract.version}`
            : null;
    const {
        scrollRef: contractScrollRef,
        hasScrolledToEnd: contractScrolledToEnd,
        onScroll: onContractScroll,
    } = useContractScrollEnd(contractScrollKey);

    useEffect(() => {
        if (showContractStep) {
            setValue('contractAccepted', false);
        }
    }, [showContractStep, contractScrollKey, setValue]);

    useEffect(() => {
        if (isListingPlan) {
            setValue('is_paid', false);
            setValue('entry_qr_ttl_seconds', '90');
            setValue('allow_printed_tickets', false);
            setValue('validator_show_holder', false);
            setValue('credit_consumption_enabled', false);
        } else if (requiresPaidTickets) {
            setValue('is_paid', true);
        }
    }, [isListingPlan, requiresPaidTickets, setValue]);

    // LOGS DE DEBUG

    // Função para formatar as faixas de comissão em HTML
    const formatCommissionRangesToHtml = (ranges: CommissionRange[]) => {
        if (!ranges || ranges.length === 0) {
            return "<p style=\"color: #ff0000;\">Nenhuma faixa de comissão ativa encontrada. Contate o administrador.</p>";
        }

        let html = '<div style=\"margin-top: 1.5rem; border: 1px solid #d4af37; border-radius: 0.5rem; padding: 1rem; background-color: rgba(0,0,0,0.6);\">' +
                   '<h4 style=\"color: #d4af37; font-size: 1.25rem; margin-bottom: 1rem;\">Faixas de Comissão Ativas:</h4>' +
                   '<table style=\"width: 100%; border-collapse: collapse;\">' +
                   '<thead><tr>' +
                   '<th style=\"border: 1px solid #d4af37; padding: 0.5rem; text-align: left; color: #d4af37;\">Ingressos</th>' +
                   '<th style=\"border: 1px solid #d4af37; padding: 0.5rem; text-align: left; color: #d4af37;\">Comissão (%)</th>' +
                   '</tr></thead><tbody>';

        ranges.forEach(range => {
            const maxTickets = range.max_tickets === 999999 ? 'ou mais' : range.max_tickets.toLocaleString('pt-BR');
            html += '<tr>' +
                    `<td style=\"border: 1px solid #d4af37; padding: 0.5rem; color: #facc15;\">${range.min_tickets.toLocaleString('pt-BR')} - ${maxTickets}</td>` +
                    `<td style=\"border: 1px solid #d4af37; padding: 0.5rem; color: #facc15;\">${range.percentage.toFixed(2).replace('.', ',')}%</td>` +
                    '</tr>';
        });

        html += '</tbody></table></div>';
        return html;
    };

    // Processar o conteúdo do contrato para substituir o placeholder
    const processedContractContent = React.useMemo(() => {
        if (!activeContract) return '';

        const rangesHtml = formatCommissionRangesToHtml(commissionRanges || []);
        const normalized = normalizeContractContentForDisplay(activeContract.content);
        const withRanges = normalized.replace('X%', rangesHtml);
        if (looksLikeContractHtml(withRanges.trim())) {
            return withRanges.trim();
        }
        return prepareContractContentForHtmlDisplay(normalized).replace(
            'X%',
            rangesHtml,
        );
    }, [activeContract, commissionRanges]);

    // Se estiver editando um evento gratuito já existente, carrega turmas salvas
    useEffect(() => {
        const loadTurmas = async () => {
            if (!eventId) return;
            // Reseta estado ao trocar o evento (evita comparar com turmas de outro event).
            setUseTurmas(false);
            setOriginalTurmas([]);
            try {
                const { data, error } = await supabase
                    .from('event_turmas')
                    .select('id, nome, capacity')
                    .eq('event_id', eventId)
                    .order('created_at', { ascending: true });

                if (error) {
                    console.error('Erro ao carregar turmas do evento:', error);
                    return;
                }

                if (data && data.length > 0) {
                    setUseTurmas(true);
                    const normalized = data.map((t: any, idx: number) => ({
                        id: t.id,
                        nome: (t.nome || `Turma ${idx + 1}`).toString(),
                        capacity: Number(t.capacity ?? 0),
                    }));
                    setOriginalTurmas(normalized);
                    lockedTurmasRef.current = normalized.map((t) => ({
                        nome: t.nome,
                        capacity: t.capacity,
                    }));
                    setTurmasDraft(
                        normalized.map((t) => ({
                            id: t.id,
                            nome: t.nome,
                            capacity: String(t.capacity),
                        })),
                    );
                } else {
                    setOriginalTurmas([]);
                    lockedTurmasRef.current = [];
                    setTurmasDraft([
                        { nome: 'Turma 1', capacity: '50' },
                        { nome: 'Turma 2', capacity: '50' },
                    ]);
                }
            } catch (e) {
                console.error('Falha ao carregar turmas:', e);
            }
        };

        loadTurmas();
    }, [eventId]);

    useEffect(() => {
        const loadEventEditExtras = async () => {
            if (!eventId) {
                setEditPricingLoading(false);
                return;
            }
            setEditPricingLoading(true);
            try {
                const { data: event, error: eventError } = await supabase
                    .from('events')
                    .select(
                        'is_paid, allow_printed_tickets, entry_qr_ttl_seconds, validator_show_holder, credit_consumption_enabled, inventory_mode, ticket_price, contract_id, capacity, date',
                    )
                    .eq('id', eventId)
                    .maybeSingle();

                if (eventError || !event) return;

                const eventIsPaid = Boolean(event.is_paid);
                lockedIsPaidRef.current = eventIsPaid;
                setValue('is_paid', eventIsPaid);
                setValue('allow_printed_tickets', Boolean(event.allow_printed_tickets));
                const ttl = Number((event as { entry_qr_ttl_seconds?: number }).entry_qr_ttl_seconds);
                setValue(
                    'entry_qr_ttl_seconds',
                    ttl === 60 || ttl === 120 ? String(ttl) : '90',
                );
                setValue(
                    'validator_show_holder',
                    (event as { validator_show_holder?: boolean }).validator_show_holder !== false,
                );
                setValue(
                    'credit_consumption_enabled',
                    (event as { credit_consumption_enabled?: boolean }).credit_consumption_enabled === true,
                );
                if (event.contract_id) {
                    setValue('contract_id', event.contract_id);
                    setValue('contractAccepted', true);
                }

                if (event.ticket_price != null && event.ticket_price !== '') {
                    const priceNum = Number(event.ticket_price);
                    if (!Number.isNaN(priceNum)) {
                        setValue('ticket_price', priceNum.toFixed(2).replace('.', ','));
                    }
                }

                if (!event.is_paid) return;

                const { data: batches, error: batchError } = await supabase
                    .from('event_batches')
                    .select('name, quantity, price, start_date, end_date')
                    .eq('event_id', eventId)
                    .order('start_date', { ascending: true });

                if (batchError && batchError.code !== 'PGRST205') {
                    console.error('Erro ao carregar lotes do evento:', batchError);
                    return;
                }

                const formatPriceBr = (price: unknown) => {
                    const n = typeof price === 'number' ? price : parseFloat(String(price ?? ''));
                    if (Number.isNaN(n)) return '';
                    return n.toFixed(2).replace('.', ',');
                };

                if (batches && batches.length > 0) {
                    const mapped = batches.map((b, idx) => ({
                        name: (b.name as string)?.trim() || `Lote ${idx + 1}`,
                        quantity: String(b.quantity ?? ''),
                        price: formatPriceBr(b.price),
                        start_date: parseEventLocalDay(String(b.start_date ?? '')) ?? undefined,
                        end_date: parseEventLocalDay(String(b.end_date ?? '')) ?? undefined,
                    }));
                    setValue('num_batches', String(mapped.length));
                    setValue('batches', mapped);
                    lockedBatchesRef.current = snapshotBatchesForLock(mapped);
                    methods.clearErrors('batches');
                    return;
                }

                // Eventos pagos antigos sem registros em event_batches
                const eventDate = event.date ? parseEventLocalDay(String(event.date)) : undefined;
                const fallbackQty = String(event.capacity ?? methods.getValues('capacity') ?? '1');
                setValue('num_batches', '1');
                const fallbackBatches = [
                    {
                        name: 'Lote 1',
                        quantity: fallbackQty,
                        price:
                            event.ticket_price != null
                                ? formatPriceBr(event.ticket_price)
                                : '',
                        start_date: eventDate,
                        end_date: eventDate,
                    },
                ];
                setValue('batches', fallbackBatches);
                lockedBatchesRef.current = snapshotBatchesForLock(fallbackBatches);
                methods.clearErrors('batches');
            } catch (e) {
                console.error('Erro ao carregar dados de edição do evento:', e);
            } finally {
                setEditPricingLoading(false);
            }
        };
        loadEventEditExtras();
    }, [eventId, setValue, methods]);

    // AGORA PODEMOS FAZER OS RETURNS CONDICIONAIS
    // Garante que o userId esteja disponível para ImageUploadPicker
    if (isLoadingProfile || isLoadingCompany || isLoadingCompanyBilling || isLoadingContract || isLoadingCommissionRanges) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando informações essenciais...</p>
            </div>
        );
    }

    if (!userId || !profile) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <XCircle className="h-8 w-8 text-red-500 mx-auto mb-4" />
                <p className="text-red-400">Não foi possível carregar as informações do usuário. Por favor, tente novamente.</p>
            </div>
        );
    }

    const onSubmit = async (values: EventFormData) => {
        if (!userId || !profile) {
            showError("Informações do usuário não carregadas.");
            return;
        }

        // Aguarda o carregamento do contrato se ainda estiver carregando
        if (isLoadingContract) {
            showError("Aguarde o carregamento do contrato...");
            return;
        }

        if (freezeFormAfterCreate) {
            showError(
                'Este evento já foi criado. Use a janela de ingressos ou feche-a antes de salvar de novo.',
            );
            return;
        }

        const effectiveContractId =
            companyBillingReady && companyBilling?.billing_contract_id
                ? companyBilling.billing_contract_id
                : activeContract?.id ?? null;

        // Validação: Para eventos pagos, é obrigatório ter contrato (empresa ou evento)
        if (values.is_paid) {
            if (!effectiveContractId && !activeContract) {
                showError("Para eventos pagos, é obrigatório existir um contrato de comissão ativo. Confirme o plano em Configurações → Perfil da Empresa ou contate o administrador.");
                return;
            }
            if (!companyBillingReady && !values.contractAccepted) {
                showError("Para eventos pagos, você DEVE aceitar o contrato de percentual de comissão sobre a quantidade de ingressos vendidos antes de salvar o evento. Confirme o plano em Perfil da Empresa ou aceite o contrato neste formulário.");
                if (showContractStep) {
                    setCurrentStep(1);
                    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100);
                }
                return;
            }
            // Validação: Se é evento pago, deve ter lotes válidos
            if (!values.batches || values.batches.length === 0) {
                showError("Para eventos pagos, é obrigatório cadastrar pelo menos um lote de ingressos.");
                setCurrentStep(showContractStep ? 4 : 3);
                setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100);
                return;
            }
            // Valida se todos os lotes estão preenchidos corretamente
            const invalidBatches = values.batches.some(batch => 
                !batch.name || 
                !batch.quantity || 
                !batch.price || 
                !batch.start_date || 
                !batch.end_date
            );
            if (invalidBatches) {
                showError("Por favor, preencha todos os campos dos lotes de ingressos antes de salvar.");
                setCurrentStep(showContractStep ? 4 : 3);
                setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100);
                return;
            }
        } else if (showContractStep && !values.contractAccepted) {
            showError("Você deve aceitar o contrato para criar/atualizar o evento, ou confirme o plano em Perfil da Empresa.");
            if (currentStep !== 1) {
                setCurrentStep(1);
                setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100);
            }
            return;
        }

        if (!companyBillingReady && profile?.tipo_usuario_id === 2 && company?.id) {
            showError("Confirme o plano e o contrato em Configurações → Perfil da Empresa → Plano e cobrança antes de criar eventos.");
            return;
        }

        if (ticketsLocked && salesGuard && eventId) {
            const lockedPaid = lockedIsPaidRef.current ?? Boolean(initialData?.is_paid);
            if (values.is_paid !== lockedPaid) {
                showError(
                    'Não é possível alterar se o evento é pago ou gratuito após haver vendas ou inscrições.',
                );
                setCurrentStep(showContractStep ? 3 : 2);
                return;
            }
            if (
                values.is_paid &&
                lockedBatchesRef.current &&
                batchesDifferFromSnapshot(values.batches, lockedBatchesRef.current)
            ) {
                showError(
                    'Lotes, preços e quantidades não podem ser alterados após ingressos vendidos. Atualize apenas local, endereço, imagens e descrição.',
                );
                setCurrentStep(showContractStep ? 4 : 3);
                return;
            }
            if (
                !values.is_paid &&
                useTurmas &&
                lockedTurmasRef.current &&
                turmasDifferFromSnapshot(turmasDraft, lockedTurmasRef.current)
            ) {
                showError(
                    'Turmas e capacidades não podem ser alteradas após inscrições no evento gratuito.',
                );
                setCurrentStep(showContractStep ? 4 : 3);
                return;
            }
            if (Number(values.capacity) < salesGuard.min_capacity) {
                showError(
                    `A capacidade não pode ser menor que ${salesGuard.min_capacity} (ingressos já vendidos ou inscritos).`,
                );
                setCurrentStep(showContractStep ? 3 : 2);
                return;
            }
        }

        const submitIsPaid = isListingPlan ? false : requiresPaidTickets ? true : values.is_paid;
        const skipBatchMinCheck = Boolean(ticketsLocked && lockedBatchesRef.current);
        if (requiresPaidTickets && submitIsPaid && !skipBatchMinCheck) {
            const batchMinError = validateMinBatchTicketSum(values.batches, companyMinEventTickets);
            if (batchMinError) {
                showError(batchMinError);
                setCurrentStep(showContractStep ? 4 : 3);
                setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100);
                return;
            }
        }

        if (submitInFlightRef.current) {
            return;
        }
        submitInFlightRef.current = true;

        const sessionDraftId = !eventId && userId ? readManagerCreateEventDraftId(userId) : undefined;
        const persistenceEventId =
            eventId ??
            (draftPersistedEventId && draftPersistedEventId.trim() !== '' ? draftPersistedEventId : undefined) ??
            sessionDraftId ??
            createdEventIdRef.current ??
            undefined;
        const willInsertNewRow = !persistenceEventId;

        setIsSaving(true);
        const toastId = showLoading(persistenceEventId ? "Atualizando evento..." : "Criando novo evento...");

        try {
            const TIPO_GESTOR_PRO = 2;
            const isGestorPro = Number(profile.tipo_usuario_id) === TIPO_GESTOR_PRO;

            let companyIdForEvent: string | null =
                typeof company?.id === 'string' && company.id.trim() !== '' ? company.id.trim() : null;

            if (isGestorPro) {
                try {
                    const fromDb = await fetchManagerPrimaryCompanyId(supabase, userId);
                    if (fromDb) {
                        companyIdForEvent = fromDb;
                    }
                } catch (linkReadErr: unknown) {
                    console.error('[EventFormSteps] Falha ao ler user_companies no save:', linkReadErr);
                }

                if (!companyIdForEvent) {
                    try {
                        const ensured = await ensureGestorCompanyLinked(supabase, userId, {
                            tipo_usuario_id: Number(profile.tipo_usuario_id),
                            natureza_juridica_id: profile.natureza_juridica_id,
                            first_name: profile.first_name,
                            last_name: profile.last_name,
                            cpf: profile.cpf,
                            cep: profile.cep,
                            rua: profile.rua,
                            bairro: profile.bairro,
                            cidade: profile.cidade,
                            estado: profile.estado,
                            numero: profile.numero,
                            complemento: profile.complemento || null,
                        });
                        if (ensured) {
                            companyIdForEvent = ensured.id;
                            await queryClient.invalidateQueries({ queryKey: ['managerCompany', userId] });
                        }
                    } catch (ensureErr: unknown) {
                        dismissToast(toastId);
                        const msg =
                            ensureErr instanceof Error
                                ? ensureErr.message
                                : 'Não foi possível vincular empresa ao seu perfil.';
                        showError(msg);
                        return;
                    }
                }

                if (!companyIdForEvent) {
                    dismissToast(toastId);
                    const nj = profile.natureza_juridica_id != null ? Number(profile.natureza_juridica_id) : null;
                    if (nj === 2) {
                        showError(
                            'Sua conta é Pessoa Jurídica, mas não há empresa vinculada (user_companies). Conclua o cadastro da empresa em Configurações / registro de gestor; se o cadastro antigo falhou no vínculo, refaça ou peça suporte para associar seu user_id à empresa.',
                        );
                    } else {
                        showError(
                            'Não foi possível obter a empresa vinculada ao seu usuário. Verifique: (1) em user_companies existe linha com seu user_id; (2) políticas RLS de user_companies/companies permitem SELECT para authenticated; (3) se é PJ, cadastre a empresa em Configurações; (4) se é PF, CPF completo (11 dígitos) no perfil.',
                        );
                    }
                    return;
                }
            }

            const effectiveIsPaid = isListingPlan ? false : requiresPaidTickets ? true : values.is_paid;
            const entryQrTtl = (['60', '90', '120'] as const).includes(
                String(values.entry_qr_ttl_seconds ?? '90') as '60' | '90' | '120',
            )
                ? Number(values.entry_qr_ttl_seconds ?? 90)
                : 90;

            // Quantidade total de ingressos: pago = soma dos lotes; gratuito = capacidade (exigido pelo banco como valor positivo)
            const totalTicketsQuantity = values.batches && values.batches.length > 0
                ? values.batches.reduce((sum, batch) => sum + batchQuantityAsNumber(batch.quantity), 0)
                : 0;
            const totalTickets = effectiveIsPaid ? totalTicketsQuantity : Number(values.capacity);

            // Preço mínimo para exibição no card: lotes têm prioridade; senão usa o campo único ticket_price
            const minPriceFromBatches = effectiveIsPaid && values.batches?.length
                ? Math.min(...values.batches.map(b => parseFloat(String(b.price || '0').replace(',', '.')) || 0))
                : null;
            const ticketPriceForEvent = effectiveIsPaid
                ? (minPriceFromBatches ?? (values.ticket_price ? parseFloat(values.ticket_price.replace(',', '.')) : null))
                : null;

            const clientSubmitId =
                !persistenceEventId && userId ? getOrCreateClientSubmitId(userId) : undefined;

            // Com empresa já vinculada, publica automaticamente (evita ficar preso em "pending").
            const eventStatus = companyIdForEvent ? 'approved' : 'pending';
            const createSuccessMessage = requiresPaidTickets
                ? 'Evento criado. Cadastre os ingressos e depois ative o evento na lista.'
                : companyIdForEvent
                  ? 'Evento criado com sucesso e publicado!'
                  : 'Evento criado com sucesso e enviado para aprovação!';

            const resolvedGeo = await resolveEventGeoOnSave({
                address: values.address,
                location: values.location,
                address_lat: values.address_lat ?? null,
                address_lng: values.address_lng ?? null,
                address_place_id: values.address_place_id ?? null,
            });

            const eventData: Record<string, unknown> = {
                title: values.title,
                description: values.description,
                highlights: parseHighlightsText(values.highlights_text),
                date: format(values.date!, 'yyyy-MM-dd'),
                time: values.time ? values.time.slice(0, 5) : null,
                location: values.location,
                address: resolvedGeo.address,
                address_lat: resolvedGeo.address_lat ?? null,
                address_lng: resolvedGeo.address_lng ?? null,
                address_place_id:
                    typeof resolvedGeo.address_place_id === 'string'
                        ? resolvedGeo.address_place_id.trim() || null
                        : resolvedGeo.address_place_id ?? null,
                image_url: values.card_image_url || '',
                card_image_url: values.card_image_url,
                exposure_card_image_url: values.exposure_card_image_url,
                banner_image_url: values.banner_image_url,
                min_age: Number(values.min_age),
                category: values.category,
                capacity: effectiveIsPaid && totalTicketsQuantity > 0
                    ? totalTicketsQuantity
                    : Number(values.capacity),
                duration: values.duration,
                is_paid: effectiveIsPaid,
                allow_printed_tickets: effectiveIsPaid ? Boolean(values.allow_printed_tickets) : false,
                entry_qr_ttl_seconds: effectiveIsPaid ? entryQrTtl : 90,
                validator_show_holder: effectiveIsPaid ? Boolean(values.validator_show_holder) : false,
                credit_consumption_enabled:
                    supportsCreditConsumption ? Boolean(values.credit_consumption_enabled) : false,
                inventory_mode: effectiveIsPaid ? 'counter' : 'unit_rows',
                checkout_queue_enabled: effectiveIsPaid && totalTicketsQuantity >= 5000,
                checkout_async_webhook: effectiveIsPaid,
                checkout_admit_per_minute: 120,
                checkout_rate_limit_per_minute: 30,
                listing_only: isListingPlan,
                total_tickets: isListingPlan ? Number(values.capacity) : totalTickets,
                ticket_price: effectiveIsPaid ? ticketPriceForEvent : null,
                created_by: userId,
                company_id: companyIdForEvent,
                status: eventStatus,
                contract_id: effectiveContractId,
                contract_version:
                    companyBilling?.billing_contract_version ??
                    (activeContract?.id === effectiveContractId ? activeContract?.version : null) ??
                    null,
            };
            if (clientSubmitId) {
                eventData.client_submit_id = clientSubmitId;
            }

            // Com vendas, não sobrescreve totais/preço/tipo no registro do evento (lotes não são recriados).
            if (persistenceEventId && ticketsLocked) {
                delete eventData.total_tickets;
                delete eventData.ticket_price;
                delete eventData.is_paid;
            }

            let newEventId = persistenceEventId;
            if (persistenceEventId) {
                const { error } = await supabase
                    .from('events')
                    .update(eventData)
                    .eq('id', persistenceEventId);

                if (error) throw error;
                dismissToast(toastId);
                showSuccess(
                    companyIdForEvent
                        ? 'Evento atualizado com sucesso e publicado!'
                        : 'Evento atualizado com sucesso!',
                );
            } else {
                const { data, error } = await supabase
                    .from('events')
                    .insert([eventData])
                    .select('id')
                    .single();

                if (error) {
                    const isUniqueViolation = String(error.code) === '23505';
                    const isDupClientSubmit = isUniqueViolation && !!clientSubmitId;

                    if (isDupClientSubmit) {
                        const { data: existing, error: fetchErr } = await supabase
                            .from('events')
                            .select('id')
                            .eq('client_submit_id', clientSubmitId)
                            .maybeSingle();

                        if (!fetchErr && existing?.id) {
                            newEventId = existing.id;
                            createdEventIdRef.current = existing.id;
                            if (userId) persistManagerCreateEventDraftId(userId, existing.id);
                            dismissToast(toastId);
                            showSuccess(createSuccessMessage);
                        } else {
                            dismissToast(toastId);
                            throw error;
                        }
                    } else {
                        dismissToast(toastId);
                        throw error;
                    }
                } else if (data?.id) {
                    newEventId = data.id;
                    createdEventIdRef.current = data.id;
                    if (userId) persistManagerCreateEventDraftId(userId, data.id);
                    dismissToast(toastId);
                    showSuccess(createSuccessMessage);
                }
            }

            // Lógica para lotes (se for pago) — não recria lotes se já houve vendas
            const skipBatchRewrite =
                Boolean(eventId && salesGuard?.has_sales && lockedBatchesRef.current);
            if (effectiveIsPaid && newEventId && values.batches && !skipBatchRewrite) {
                try {
                    if (effectiveIsPaid && newEventId) {
                        await supabase.rpc('cleanup_orphan_counter_wristbands', {
                            p_event_id: newEventId,
                        });
                    }

                    // Exclui lotes antigos para recriar (simples para este exemplo, considerar updates mais complexos para produção)
                    const { error: deleteError } = await supabase
                        .from('event_batches')
                        .delete()
                        .eq('event_id', newEventId);

                    // Se a tabela não existir neste ambiente, apenas registra log e segue sem quebrar o fluxo
                    if (deleteError && deleteError.code !== 'PGRST205') {
                        throw deleteError;
                    }

                    const batchesToInsert = values.batches.map(batch => ({
                        event_id: newEventId,
                        name: batch.name,
                        quantity: batchQuantityAsNumber(batch.quantity),
                        price: parseFloat(batch.price.replace(',', '.')),
                        start_date: format(batch.start_date!, 'yyyy-MM-dd'),
                        end_date: format(batch.end_date!, 'yyyy-MM-dd'),
                    }));

                    const { error: batchesError } = await supabase
                        .from('event_batches')
                        .insert(batchesToInsert);
                    
                    if (batchesError && batchesError.code !== 'PGRST205') {
                        throw batchesError;
                    }

                    // Só mostra sucesso se a tabela existir e a operação for concluída
                    if (!deleteError && !batchesError) {
                        if (effectiveIsPaid && newEventId) {
                            const { error: backfillError } = await supabase.rpc(
                                'backfill_event_counter_inventory',
                                { p_event_id: newEventId },
                            );
                            if (backfillError) {
                                console.error('[EventFormSteps] backfill_event_counter_inventory:', backfillError);
                            }
                        }
                    }
                } catch (batchError: unknown) {
                    console.error("Erro ao salvar lotes do evento:", batchError);
                    const msg =
                        batchError && typeof batchError === 'object' && 'message' in batchError
                            ? String((batchError as { message?: string }).message)
                            : 'Erro desconhecido';
                    const friendlyBatchMsg = msg.includes('soma das quantidades dos lotes')
                        ? msg.replace(/pulseiras/gi, 'ingressos')
                        : msg;
                    showError(
                        `Evento salvo, mas os lotes de ingressos não foram gravados: ${friendlyBatchMsg}. ` +
                            'Se for erro de permissão (RLS), aplique a migration event_batches_rls no Supabase.',
                    );
                }
            }

            // Lógica para turmas (somente eventos gratuitos) — não reestrutura se já houve inscrições
            const skipTurmaRewrite = Boolean(eventId && salesGuard?.has_sales);
            if (!effectiveIsPaid && newEventId && !skipTurmaRewrite) {
                try {
                    // Normaliza draft para comparar e persistir.
                    const normalizedDraft = turmasDraft
                        .map((t, idx) => ({
                            nome: (t.nome || '').trim() || `Turma ${idx + 1}`,
                            capacity: Number(t.capacity),
                        }))
                        .filter((t) => t.capacity >= 0 && t.nome.length > 0);

                    if (normalizedDraft.length < 1) {
                        throw new Error('Cadastre ao menos 1 turma válida.');
                    }

                    // Se toggle estiver desligado, remove turmas existentes.
                    if (!useTurmas) {
                        const { error: turmaDeleteError } = await supabase
                            .from('event_turmas')
                            .delete()
                            .eq('event_id', newEventId);

                        if (turmaDeleteError) throw turmaDeleteError;

                        setOriginalTurmas([]);
                    } else {
                        // Se nada mudou ao editar, não regrava para evitar duplicidade/lixo.
                        const hasChanges =
                            normalizedDraft.length !== originalTurmas.length ||
                            normalizedDraft.some((t, idx) => {
                                const o = originalTurmas[idx];
                                if (!o) return true;
                                return o.nome !== t.nome || o.capacity !== t.capacity;
                            });

                        if (!hasChanges) {
                            // Mantém o que já está no banco.
                        } else {
                            const { error: turmaDeleteError } = await supabase
                                .from('event_turmas')
                                .delete()
                                .eq('event_id', newEventId);

                            if (turmaDeleteError) throw turmaDeleteError;

                            const turmasToInsert = normalizedDraft.map((t) => ({
                                event_id: newEventId,
                                nome: t.nome,
                                capacity: t.capacity,
                            }));

                            const { error: turmaInsertError } = await supabase
                                .from('event_turmas')
                                .insert(turmasToInsert);

                            if (turmaInsertError) throw turmaInsertError;

                            // Atualiza referência local para a próxima edição/salvamento.
                            setOriginalTurmas(
                                normalizedDraft.map((t, idx) => ({
                                    id: originalTurmas[idx]?.id || 'temp',
                                    nome: t.nome,
                                    capacity: t.capacity,
                                })),
                            );
                        }
                    }
                } catch (turmaError: any) {
                    console.error('Erro ao salvar turmas:', turmaError);
                    // Não derruba o fluxo do evento; apenas avisa.
                    showError('Evento salvo, mas não foi possível salvar as turmas. Tente novamente.');
                }
            }

            queryClient.invalidateQueries({ queryKey: ['managerEvents', userId] });
            queryClient.invalidateQueries({ queryKey: ['publicEvents'] });

            if (willInsertNewRow && onCreateSuccess && newEventId) {
                onCreateSuccess(newEventId);
            } else {
                navigate('/manager/events');
            }

        } catch (error: any) {
            dismissToast(toastId);
            console.error("Erro ao salvar evento:", error);
            showError(`Falha ao salvar evento: ${error.message || 'Erro desconhecido'}`);
        } finally {
            submitInFlightRef.current = false;
            setIsSaving(false);
        }
    };

    // Determina qual passo deve ser exibido baseado no currentStep e no contrato
    const getStepToRender = () => {
        if (isLoadingContract || isLoadingCommissionRanges || isLoadingCompanyBilling) {
            return 'loading';
        }
        
        if (showContractStep) {
            if (currentStep === 1) return 'contract';
            if (currentStep === 2) return 'details';
            if (currentStep === 3) return 'media';
            if (currentStep === 4) return 'pricing';
        } else {
            // Se não há contrato
            if (currentStep === 1) return 'details';
            if (currentStep === 2) return 'media';
            if (currentStep === 3) return 'pricing';
        }
        return 'details'; // Fallback
    };

    const stepToRender = getStepToRender();
    const maxFormStep = showContractStep ? (isListingPlan ? 3 : 4) : isListingPlan ? 2 : 3;

    const onValidationError = (errors: Parameters<Parameters<typeof handleSubmit>[1]>[0]) => {
        console.error("Erros de validação:", errors);
        const firstError = Object.values(errors)[0];
        if (firstError?.message) {
            showError(firstError.message as string);
        } else {
            showError("Por favor, verifique todos os campos obrigatórios antes de salvar.");
        }

        if (errors.date || errors.time || errors.title || errors.description) {
            setCurrentStep(showContractStep ? 2 : 1);
        } else if (errors.card_image_url || errors.exposure_card_image_url || errors.banner_image_url) {
            setCurrentStep(showContractStep ? 3 : 2);
        } else if (errors.batches || errors.num_batches) {
            setCurrentStep(showContractStep ? 4 : 3);
        }
    };

    const onFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        if (submitInFlightRef.current) {
            e.preventDefault();
            return;
        }
        void handleSubmit(onSubmit, onValidationError)(e);
    };

    return (
        <FormProvider {...methods}>
            <div ref={formTopRef} className="scroll-mt-24" aria-hidden />
            <form
                onSubmit={onFormSubmit}
                className={cn('space-y-8', freezeFormAfterCreate && 'pointer-events-none opacity-60')}
                aria-disabled={freezeFormAfterCreate || undefined}
            >
                {/* Loading do Contrato */}
                {stepToRender === 'loading' && (
                    <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10 p-6">
                        <div className="text-center py-8">
                            <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-4" />
                            <p className="text-gray-400 text-sm">Carregando contrato...</p>
                        </div>
                    </Card>
                )}

                {/* Passo 0: Aceite do Contrato (Opcional, se houver contrato ativo) */}
                {stepToRender === 'contract' && activeContract && (
                    <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10 p-6">
                        <CardHeader>
                            <CardTitle className="text-yellow-500 text-2xl flex items-center">
                                <FileText className="h-6 w-6 mr-2" />
                                Contrato de Evento: {activeContract.title} (v{activeContract.version})
                            </CardTitle>
                            <CardDescription className="text-gray-400">Por favor, leia e aceite os termos do contrato para prosseguir.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div
                                ref={contractScrollRef}
                                onScroll={onContractScroll}
                                className="prose prose-invert max-w-none max-h-[400px] overflow-y-auto overscroll-contain p-4 border border-yellow-500/20 rounded-lg text-gray-200 break-words
                                [&_h2]:mt-8 [&_h2]:mb-4 [&_h2]:text-yellow-500/95
                                [&_h3]:mt-6 [&_h3]:mb-3 [&_h3]:text-yellow-500/90
                                [&_p]:my-4 [&_p]:leading-relaxed
                                [&_ul]:my-4 [&_ol]:my-4"
                            >
                                <div dangerouslySetInnerHTML={{ __html: processedContractContent }} />
                            </div>
                            <ContractScrollHint visible={!contractScrolledToEnd} className="text-amber-400" />
                            <FormField
                                control={control}
                                name="contractAccepted"
                                render={({ field }) => (
                                    <FormItem
                                        className={`flex flex-row items-start space-x-3 space-y-0 rounded-md border border-yellow-500/30 p-4 mt-4 ${contractScrolledToEnd ? '' : 'opacity-60'}`}
                                    >
                                        <FormControl>
                                            <Checkbox
                                                checked={field.value}
                                                disabled={!contractScrolledToEnd}
                                                onCheckedChange={(v) => {
                                                    if (contractScrolledToEnd) field.onChange(v);
                                                }}
                                                className="border-yellow-500 text-yellow-500 data-[state=checked]:bg-yellow-500 data-[state=checked]:text-black"
                                            />
                                        </FormControl>
                                        <div className="space-y-1 leading-none">
                                            <FormLabel className="text-white">
                                                Eu li e aceito os termos do contrato acima.
                                            </FormLabel>
                                            <FormDescription className="text-gray-400 text-xs">
                                                Role até o final do contrato para habilitar esta opção.
                                            </FormDescription>
                                        </div>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </CardContent>
                    </Card>
                )}

                {/* Passo 1: Informações Básicas */}
                {stepToRender === 'details' && (
                    <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10 p-6">
                        <CardHeader>
                            <CardTitle className="text-yellow-500 text-2xl">{showContractStep ? '2.' : '1.'} Detalhes do Evento</CardTitle>
                            <CardDescription className="text-gray-400">Informações essenciais sobre o seu evento.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <FormField
                                control={control}
                                name="title"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-white">Título do Evento</FormLabel>
                                        <FormControl>
                                            <Input 
                                                placeholder="Ex: Show de Rock da Banda XYZ" 
                                                className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500"
                                                {...field} 
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={control}
                                name="description"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-white">Descrição Detalhada</FormLabel>
                                        <FormControl>
                                            <Textarea 
                                                placeholder="Descreva seu evento em detalhes..." 
                                                rows={5}
                                                className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500"
                                                {...field} 
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={control}
                                name="highlights_text"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-white">
                                            Destaques do evento (opcional)
                                        </FormLabel>
                                        <FormControl>
                                            <Textarea
                                                placeholder={'Um item por linha. Ex.:\nArtista principal confirmado\nOpen bar\nEstacionamento gratuito'}
                                                rows={4}
                                                className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500"
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormDescription className="text-gray-500 text-xs">
                                            Aparecem como lista na página pública do evento. Máximo{' '}
                                            {MAX_EVENT_HIGHLIGHTS} itens, um por linha.
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <FormField
                                    control={control}
                                    name="date"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-white">Data do Evento</FormLabel>
                                            <FormControl>
                                                <DatePicker 
                                                    date={field.value} 
                                                    setDate={field.onChange} 
                                                    placeholder="Selecione a data" 
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={control}
                                    name="time"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-white">Hora do Evento</FormLabel>
                                            <FormControl>
                                                <Input 
                                                    type="time" 
                                                    placeholder="HH:MM" 
                                                    className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500"
                                                    {...field} 
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                            <EventLocationFormFields />
                            {supportsCreditConsumption && (
                                <FormField
                                    control={control}
                                    name="credit_consumption_enabled"
                                    render={({ field }) => (
                                        <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border border-yellow-500/30 p-4 bg-black/40">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    className="border-yellow-500 text-yellow-500 data-[state=checked]:bg-yellow-500 data-[state=checked]:text-black"
                                                />
                                            </FormControl>
                                            <div className="space-y-1 leading-none">
                                                <FormLabel className="text-white">
                                                    Aceitar pagamento com crédito EventFest
                                                </FormLabel>
                                                <FormDescription className="text-gray-400 text-xs">
                                                    Clientes podem comprar ingressos deste evento usando saldo da carteira
                                                    EventFest (rede de parceiros).
                                                </FormDescription>
                                            </div>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* Passo 2: Mídias e Outras Configurações */}
                {stepToRender === 'media' && (
                    <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10 p-6">
                        <CardHeader>
                            <CardTitle className="text-yellow-500 text-2xl">{showContractStep ? '3.' : '2.'} Mídias e Configurações</CardTitle>
                            <CardDescription className="text-gray-400">Imagens e detalhes adicionais do evento.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <FormField
                                control={control}
                                name="card_image_url"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-white">Imagem do Card (proporção 16:9)</FormLabel>
                                        <FormControl>
                                            <ImageUploadPicker
                                                userId={userId!}
                                                currentImageUrl={field.value}
                                                onImageUpload={field.onChange}
                                                placeholderText="URL da imagem do card"
                                                folderPath="event_cards"
                                                width={1920}
                                                height={1080}
                                                isInvalid={!!errors.card_image_url}
                                            />
                                        </FormControl>
                                        <FormDescription className="text-gray-500 text-xs">Esta imagem será usada na listagem de eventos. Recomendado 1920x1080px.</FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                             <FormField
                                control={control}
                                name="exposure_card_image_url"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-white">Imagem de Exposição (proporção 16:9)</FormLabel>
                                        <FormControl>
                                            <ImageUploadPicker
                                                userId={userId!}
                                                currentImageUrl={field.value}
                                                onImageUpload={field.onChange}
                                                placeholderText="URL da imagem de exposição"
                                                folderPath="event_exposure_cards"
                                                width={1920}
                                                height={1080}
                                                isInvalid={!!errors.exposure_card_image_url}
                                            />
                                        </FormControl>
                                        <FormDescription className="text-gray-500 text-xs">Esta imagem será usada em carrosséis e áreas de destaque. Recomendado 1920x1080px.</FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={control}
                                name="banner_image_url"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-white">Imagem do Banner (proporção 3:1)</FormLabel>
                                        <FormControl>
                                            <ImageUploadPicker
                                                userId={userId!}
                                                currentImageUrl={field.value}
                                                onImageUpload={field.onChange}
                                                placeholderText="URL da imagem do banner"
                                                folderPath="event_banners"
                                                width={1920}
                                                height={640}
                                                isInvalid={!!errors.banner_image_url}
                                            />
                                        </FormControl>
                                        <FormDescription className="text-gray-500 text-xs">Esta imagem será usada como banner principal na página do evento. Recomendado 1920x640px.</FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <FormField
                                    control={control}
                                    name="min_age"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-white">Idade Mínima</FormLabel>
                                            <FormControl>
                                                <Input 
                                                    type="number" 
                                                    placeholder="Ex: 18" 
                                                    className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500"
                                                    {...field} 
                                                    onChange={e => field.onChange(e.target.value)}
                                                    min={0}
                                                    max={18}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={control}
                                    name="category"
                                    render={({ field }) => (
                                        <CompanyEventCategoryField
                                            companyId={company?.id}
                                            value={field.value}
                                            onChange={field.onChange}
                                        />
                                    )}
                                />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <FormField
                                    control={control}
                                    name="capacity"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-white">Capacidade Máxima de Pessoas</FormLabel>
                                            <FormControl>
                                                <Input 
                                                    type="number" 
                                                    placeholder="Ex: 1000" 
                                                    className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500"
                                                    {...field} 
                                                    onChange={e => field.onChange(e.target.value)}
                                                    min={ticketsLocked && salesGuard ? salesGuard.min_capacity : 1}
                                                />
                                            </FormControl>
                                            <FormDescription className="text-gray-300 text-xs">
                                                {showPaidPricing
                                                    ? 'Capacidade física do local. A quantidade vendável será definida nos lotes do próximo passo.'
                                                    : 'Número total de ingressos disponíveis para o evento.'}
                                                {ticketsLocked && salesGuard
                                                    ? ` Mínimo permitido: ${salesGuard.min_capacity} (já vendidos/inscritos).`
                                                    : ''}
                                            </FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={control}
                                    name="duration"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-white">Duração Estimada (horas)</FormLabel>
                                            <FormControl>
                                                <Input 
                                                    placeholder="Ex: 3 horas" 
                                                    className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500"
                                                    {...field} 
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                            {isListingPlan && (
                                <div className="p-4 rounded-xl border border-blue-400/50 bg-blue-950/60 text-sm text-blue-50 mb-4">
                                    Plano de <strong className="text-white">divulgação</strong>: evento em modo vitrine, sem venda de ingressos pela plataforma.
                                </div>
                            )}
                            {requiresPaidTickets && (
                                <div className="p-4 rounded-xl border border-cyan-400/50 bg-cyan-950/60 text-sm text-cyan-50 mb-4">
                                    Seu plano exige eventos <strong className="text-white">pagos</strong>. Defina a quantidade nos{' '}
                                    <strong className="text-white">lotes de ingressos</strong> (próximo passo). Os QR codes são
                                    gerados na venda — não é necessário emitir ingressos manualmente.
                                </div>
                            )}
                            {ticketsLocked && salesGuard && (
                                <div className="p-4 rounded-xl border border-amber-400/50 bg-amber-950/60 text-sm text-amber-50 mb-4">
                                    {salesGuardLockedMessage(salesGuard)}
                                </div>
                            )}
                            {!isListingPlan && !requiresPaidTickets && (
                            <FormField
                                control={control}
                                name="is_paid"
                                render={({ field }) => (
                                    <FormItem className={`flex flex-row items-start space-x-3 space-y-0 rounded-md border border-yellow-500/30 p-4 ${ticketsLocked ? 'opacity-50' : ''}`}>
                                        <FormControl>
                                            <Checkbox
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                                disabled={ticketsLocked}
                                                className="border-yellow-500 text-yellow-500 data-[state=checked]:bg-yellow-500 data-[state=checked]:text-black"
                                            />
                                        </FormControl>
                                        <div className="space-y-1 leading-none">
                                            <FormLabel className="text-white">Evento Pago?</FormLabel>
                                            <FormDescription className="text-gray-400 text-xs">
                                                Marque esta opção se o evento tiver ingressos pagos.
                                            </FormDescription>
                                        </div>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* Passo 3: Preço e Lotes de Ingressos (condicional) */}
                {stepToRender === 'pricing' && !isListingPlan && (
                    <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10 p-6">
                        <CardHeader>
                            <CardTitle className="text-yellow-500 text-2xl flex items-center">
                                <Ticket className="h-6 w-6 mr-2" />
                                {showContractStep ? '4.' : '3.'} Preço e Lotes de Ingressos
                            </CardTitle>
                            <CardDescription className="text-gray-400">Defina os preços e organize os ingressos em lotes.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {ticketsLocked && salesGuard && !editPricingLoading && (
                                <div className="p-4 rounded-xl border border-amber-500/40 bg-amber-500/10 text-sm text-amber-100">
                                    {salesGuardLockedMessage(salesGuard)}
                                </div>
                            )}
                            {editPricingLoading && (
                                <div className="flex items-center justify-center gap-2 py-8 text-gray-400">
                                    <Loader2 className="h-6 w-6 animate-spin text-yellow-500" />
                                    <span>Carregando lotes e configurações de ingresso…</span>
                                </div>
                            )}
                            {!editPricingLoading && showPaidPricing && (
                                <div className="space-y-4">
                                    <EventGrandePorteGuide />
                                    {eventId && (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            className="w-full sm:w-auto bg-black/60 border border-cyan-400/40 text-cyan-200 hover:bg-cyan-950/80 hover:text-white"
                                            onClick={() => navigate(`/manager/events/${eventId}/cortesias`)}
                                        >
                                            <Ticket className="h-4 w-4 mr-2" />
                                            Enviar pacotes cortesia (Staff / convidados)
                                        </Button>
                                    )}
                                    <FormField
                                        control={control}
                                        name="allow_printed_tickets"
                                        render={({ field }) => (
                                            <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border border-yellow-500/30 p-4 bg-black/40">
                                                <FormControl>
                                                    <Checkbox
                                                        checked={field.value}
                                                        onCheckedChange={field.onChange}
                                                        className="border-yellow-500 text-yellow-500 data-[state=checked]:bg-yellow-500 data-[state=checked]:text-black"
                                                    />
                                                </FormControl>
                                                <div className="space-y-1 leading-none">
                                                    <FormLabel className="text-white">
                                                        Permitir ingresso impresso na portaria
                                                    </FormLabel>
                                                    <FormDescription className="text-gray-400 text-xs">
                                                        Marcado: o leitor aceita QR fixo (impresso) e QR dinâmico do app.
                                                        Desmarcado: somente QR do aplicativo do cliente (mais seguro).
                                                    </FormDescription>
                                                </div>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={control}
                                        name="entry_qr_ttl_seconds"
                                        render={({ field }) => (
                                            <FormItem className="rounded-md border border-yellow-500/30 p-4 bg-black/40">
                                                <FormLabel className="text-white">
                                                    Validade do QR no aplicativo
                                                </FormLabel>
                                                <FormDescription className="text-gray-400 text-xs mb-2">
                                                    Tempo que cada QR dinâmico permanece válido na portaria. O app renova
                                                    automaticamente antes de expirar.
                                                </FormDescription>
                                                <Select value={field.value} onValueChange={field.onChange}>
                                                    <FormControl>
                                                        <SelectTrigger className="bg-black/60 border-yellow-500/30 text-white focus:ring-yellow-500">
                                                            <SelectValue placeholder="Selecione o tempo" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent className="bg-black border-yellow-500/30 text-white">
                                                        {ENTRY_QR_ALLOWED_TTLS.map((ttl) => (
                                                            <SelectItem
                                                                key={ttl}
                                                                value={String(ttl)}
                                                                className="hover:bg-yellow-500/10"
                                                            >
                                                                {ENTRY_QR_TTL_LABELS[ttl]}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={control}
                                        name="validator_show_holder"
                                        render={({ field }) => (
                                            <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border border-yellow-500/30 p-4 bg-black/40">
                                                <FormControl>
                                                    <Checkbox
                                                        checked={field.value}
                                                        onCheckedChange={field.onChange}
                                                        className="border-yellow-500 text-yellow-500 data-[state=checked]:bg-yellow-500 data-[state=checked]:text-black"
                                                    />
                                                </FormControl>
                                                <div className="space-y-1 leading-none">
                                                    <FormLabel className="text-white">
                                                        Exibir titular no validador (portaria)
                                                    </FormLabel>
                                                    <FormDescription className="text-gray-400 text-xs">
                                                        Após leitura OK, o operador vê nome e CPF parcial para conferir
                                                        documento. Desmarque se não quiser exibir dados na portaria.
                                                    </FormDescription>
                                                </div>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            )}
                            {!showPaidPricing && (
                                <div className="text-center py-8">
                                    <p className="text-gray-400 mb-4">Evento Gratuito. Você pode limitar as inscrições por turma.</p>

                                    <div className="flex flex-col items-center gap-4">
                                        <div className="w-full max-w-2xl flex flex-row items-start space-x-3 rounded-md border border-yellow-500/30 p-4 bg-black/40">
                                            <Checkbox
                                                checked={useTurmas}
                                                onCheckedChange={(val) => setUseTurmas(Boolean(val))}
                                                disabled={ticketsLocked}
                                                className="border-yellow-500 text-yellow-500 data-[state=checked]:bg-yellow-500 data-[state=checked]:text-black mt-1"
                                            />
                                            <div className="space-y-1 leading-none">
                                                <div className="text-white font-semibold">Usar turmas (limitar inscrições)</div>
                                                <div className="text-gray-400 text-xs">
                                                    Quando uma turma atingir a capacidade, a opção dela fica desabilitada na inscrição.
                                                </div>
                                            </div>
                                        </div>

                                        {useTurmas && (
                                            <div className="w-full max-w-2xl text-left space-y-4">
                                                {turmasDraft.map((t, idx) => (
                                                    <Card key={idx} className="bg-black/70 border border-yellow-500/20 p-4">
                                                        <div className="flex items-center justify-between mb-3 gap-3">
                                                            <CardTitle className="text-white text-base">Turma {idx + 1}</CardTitle>
                                                            <Button
                                                                type="button"
                                                                variant="destructive"
                                                                className="h-8 px-3 rounded-lg"
                                                                disabled={ticketsLocked}
                                                                onClick={() => {
                                                                    if (turmasDraft.length <= 1) {
                                                                        showError('Você precisa manter pelo menos 1 turma.');
                                                                        return;
                                                                    }
                                                                    const ok = window.confirm(`Remover "${t.nome || `Turma ${idx + 1}`}"?`);
                                                                    if (!ok) return;
                                                                    setTurmasDraft((prev) => prev.filter((_, i) => i !== idx));
                                                                }}
                                                            >
                                                                Remover
                                                            </Button>
                                                        </div>
                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                            <div>
                                                                <FormLabel className="text-white">Nome</FormLabel>
                                                                <Input
                                                                    value={t.nome}
                                                                    disabled={ticketsLocked}
                                                                    onChange={(e) => {
                                                                        const v = e.target.value;
                                                                        setTurmasDraft((prev) =>
                                                                            prev.map((x, i) => (i === idx ? { ...x, nome: v } : x)),
                                                                        );
                                                                    }}
                                                                    className="bg-black/60 border-yellow-500/30 text-white"
                                                                />
                                                            </div>
                                                            <div>
                                                                <FormLabel className="text-white">Capacidade</FormLabel>
                                                                <Input
                                                                    type="number"
                                                                    value={t.capacity}
                                                                    min={0}
                                                                    disabled={ticketsLocked}
                                                                    onChange={(e) => {
                                                                        const v = e.target.value;
                                                                        setTurmasDraft((prev) =>
                                                                            prev.map((x, i) => (i === idx ? { ...x, capacity: v } : x)),
                                                                        );
                                                                    }}
                                                                    className="bg-black/60 border-yellow-500/30 text-white"
                                                                />
                                                                <p className="text-xs text-gray-500 mt-1">
                                                                    Quantas pessoas a turma pode receber.
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </Card>
                                                ))}

                                                <div className="flex justify-center">
                                                    <Button
                                                        type="button"
                                                        disabled={ticketsLocked}
                                                        onClick={() => {
                                                            setTurmasDraft((prev) => [
                                                                ...prev,
                                                                { nome: `Turma ${prev.length + 1}`, capacity: '50' },
                                                            ]);
                                                        }}
                                                        className="bg-yellow-500 text-black hover:bg-yellow-600"
                                                    >
                                                        + Adicionar turma
                                                    </Button>
                                                </div>
                                            </div>
                                        )}

                                        <p className="text-gray-500 text-sm">
                                            Você pode prosseguir para salvar o evento.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {!editPricingLoading && showPaidPricing && (
                                <>
                                    <FormField
                                        control={control}
                                        name="num_batches"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-white">Número de Lotes</FormLabel>
                                                <FormControl>
                                                    <Input 
                                                        type="number" 
                                                        placeholder="1" 
                                                        className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500"
                                                        disabled={ticketsLocked}
                                                        {...field} 
                                                        onChange={e => field.onChange(e.target.value)} 
                                                        min={1}
                                                    />
                                                </FormControl>
                                                <FormDescription className="text-gray-500 text-xs">Quantos lotes de ingressos você deseja criar para este evento.</FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    {Array.from({ length: numBatches }).map((_, batchIndex) => (
                                        <Card key={batchIndex} className="bg-black/70 border border-yellow-500/20 p-4 space-y-4">
                                            <CardTitle className="text-white text-lg">Lote {batchIndex + 1}</CardTitle>
                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                <FormField
                                                    control={control}
                                                    name={`batches.${batchIndex}.name`}
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel className="text-white">Nome do Lote</FormLabel>
                                                            <FormControl>
                                                                <Input 
                                                                    placeholder="Ex: Standard, VIP, Staff"
                                                                    className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500"
                                                                    disabled={ticketsLocked}
                                                                    {...field} 
                                                                />
                                                            </FormControl>
                                                            <FormDescription className="text-cyan-200/80 text-xs">
                                                                Este nome é o tipo de acesso na portaria e na venda (ex.: Standard, VIP).
                                                            </FormDescription>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                                <FormField
                                                    control={control}
                                                    name={`batches.${batchIndex}.quantity`}
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel className="text-white">Quantidade de Ingressos</FormLabel>
                                                            <FormControl>
                                                                <Input 
                                                                    type="text"
                                                                    inputMode="numeric"
                                                                    placeholder="Ex: 200 ou 50.000"
                                                                    className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500"
                                                                    disabled={ticketsLocked}
                                                                    {...field} 
                                                                    onChange={(e) => field.onChange(e.target.value)}
                                                                    onBlur={(e) => {
                                                                        const normalized = parseBatchQuantity(e.target.value);
                                                                        if (normalized) field.onChange(normalized);
                                                                        field.onBlur();
                                                                    }}
                                                                />
                                                            </FormControl>
                                                            <FormDescription className="text-cyan-200/90 text-xs">
                                                                Estoque deste tipo. Os QR codes são gerados automaticamente na venda.
                                                            </FormDescription>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                                <FormField
                                                    control={control}
                                                    name={`batches.${batchIndex}.price`}
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel className="text-white">Preço (R$)</FormLabel>
                                                            <FormControl>
                                                                <Input 
                                                                    placeholder="Ex: 50,00" 
                                                                    className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500"
                                                                    disabled={ticketsLocked}
                                                                    {...field} 
                                                                    onChange={e => field.onChange(e.target.value.replace('.', ',') )}
                                                                    min="0"
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <FormField
                                                    control={control}
                                                    name={`batches.${batchIndex}.start_date`}
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel className="text-white">Data de Início das Vendas</FormLabel>
                                                            <FormControl>
                                                                <DatePicker 
                                                                    date={field.value} 
                                                                    setDate={field.onChange} 
                                                                    placeholder="Data de Início"
                                                                    disabled={ticketsLocked}
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                                <FormField
                                                    control={control}
                                                    name={`batches.${batchIndex}.end_date`}
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel className="text-white">Data de Término das Vendas</FormLabel>
                                                            <FormControl>
                                                                <DatePicker 
                                                                    date={field.value} 
                                                                    setDate={field.onChange} 
                                                                    placeholder="Data de Término"
                                                                    disabled={ticketsLocked}
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            </div>
                                        </Card>
                                    ))}
                                    
                                    {errors.batches && (
                                        <p className="text-red-500 text-sm mt-2">Houve um erro na configuração dos lotes. Verifique todos os campos.</p>
                                    )}
                                    
                                    {/* Exibe o campo de preço único se não houver lotes configurados */}
                                    {numBatches === 0 && (
                                        <FormField
                                            control={control}
                                            name="ticket_price"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-white">Preço do Ingresso (R$)</FormLabel>
                                                    <FormControl>
                                                        <Input 
                                                            placeholder="Ex: 100,00" 
                                                            className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500"
                                                            {...field} 
                                                            onChange={e => field.onChange(e.target.value.replace('.', ','))}
                                                            min="0"
                                                        />
                                                    </FormControl>
                                                    <FormDescription className="text-gray-500 text-xs">Preço individual de cada ingresso.</FormDescription>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    )}
                                </>
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* Botões de Navegação */}
                {!isLoadingContract && (
                    <div className="flex justify-between mt-8">
                        {currentStep > 1 && (
                            <Button 
                                type="button" 
                                onClick={() => {
                                    setCurrentStep(prev => prev - 1);
                                    window.setTimeout(scrollFormToTop, 0);
                                }}
                                variant="outline"
                                className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 py-2 text-base font-semibold transition-all duration-300 cursor-pointer"
                            >
                                <ArrowLeft className="mr-2 h-5 w-5" />
                                Voltar
                            </Button>
                        )}
                        {currentStep < maxFormStep && (
                            <Button 
                                type="button" 
                                onClick={() => {
                                    // Validação: se está no passo do contrato, verifica se foi aceito
                                    if (showContractStep && currentStep === 1) {
                                        const contractAccepted = methods.getValues('contractAccepted');
                                        if (!contractAccepted) {
                                            showError("Você precisa aceitar o contrato para continuar.");
                                            return;
                                        }
                                    }
                                    setCurrentStep(prev => prev + 1);
                                    window.setTimeout(scrollFormToTop, 0);
                                }}
                                className="bg-yellow-500 text-black hover:bg-yellow-600 py-2 text-base font-semibold transition-all duration-300 cursor-pointer ml-auto"
                            >
                                Próximo
                                <ArrowRight className="ml-2 h-5 w-5" />
                            </Button>
                        )}
                        {currentStep === maxFormStep && (
                            <Button
                                type="submit"
                                disabled={isSaving || freezeFormAfterCreate}
                                className="bg-yellow-500 text-black hover:bg-yellow-600 py-2 text-base font-semibold transition-all duration-300 cursor-pointer ml-auto disabled:opacity-50"
                            >
                                {isSaving ? (
                                    <div className="flex items-center justify-center">
                                        <Loader2 className="w-5 h-5 animate-spin mr-2" />
                                        Salvando...
                                    </div>
                                ) : (
                                    <>
                                        <Save className="mr-2 h-5 w-5" />
                                        Salvar Evento
                                    </>
                                )}
                            </Button>
                        )}
                    </div>
                )}
            </form>
            
            {/* Modal de Confirmação para Sair (apenas se houver dados não salvos) */}
            <AlertDialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <AlertDialogContent className="bg-black/90 border border-yellow-500/30 text-white">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-yellow-400">Descartar Alterações?</AlertDialogTitle>
                        <AlertDialogDescription className="text-gray-400">
                            Você tem alterações não salvas. Tem certeza que deseja sair e descartá-las?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10">
                            Cancelar
                        </AlertDialogCancel>
                        <AlertDialogAction 
                            onClick={() => navigate('/manager/events')}
                            className="bg-red-600 text-white hover:bg-red-700"
                        >
                            Descartar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </FormProvider>
    );
};

export default EventFormSteps;
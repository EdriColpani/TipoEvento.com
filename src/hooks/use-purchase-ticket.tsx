import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { readCachedAuthSession } from '@/utils/auth-session-cache';
import { showError, showSuccess } from '@/utils/toast';

interface PurchaseDetails {
    eventId: string;
    ticketTypeId: string; // ID da pulseira base (wristband ID)
    quantity: number;
    price: number;
}

export const usePurchaseTicket = () => {
    const [isLoading, setIsLoading] = useState(false);

    const purchaseTicket = async (details: PurchaseDetails) => {
        const { ticketTypeId, quantity, price } = details;
        
        const { userId } = readCachedAuthSession();
        if (!userId) {
            showError("Você precisa estar logado para finalizar a compra.");
            return false;
        }
        
        if (quantity <= 0) {
            showError("A quantidade de ingressos deve ser maior que zero.");
            return false;
        }

        setIsLoading(true);

        try {
            // 1. Tentar encontrar uma pulseira ATIVA disponível para este tipo (wristband_id)
            // Como o ticketTypeId é o ID da pulseira base, procuramos por registros de analytics
            // que ainda não foram associados a um cliente (client_user_id is null) e que estão 'active'.
            
            // Nota: Estamos assumindo que cada 'tipo de ingresso' na tela de detalhes corresponde a uma pulseira base (wristband)
            // e que a quantidade comprada corresponde a N registros de analytics não utilizados.
            
            // Para simplificar a transação e garantir atomicidade, vamos usar uma função RPC ou Edge Function
            // em um ambiente de produção. Aqui, faremos uma simulação de transação segura:
            
            // 2. Buscar N registros de analytics ativos e não associados, vinculados à pulseira base (ticketTypeId)
            const { data: availableAnalytics, error: fetchError } = await supabase
                .from('wristband_analytics')
                .select('id, code_wristbands')
                .eq('wristband_id', ticketTypeId)
                .eq('status', 'active')
                .is('client_user_id', null)
                .limit(quantity);

            if (fetchError) throw fetchError;

            if (!availableAnalytics || availableAnalytics.length < quantity) {
                throw new Error("Não há ingressos disponíveis suficientes para esta compra.");
            }
            
            const analyticsIdsToUpdate = availableAnalytics.map(a => a.id);
            
            // 3. Atualizar os registros de analytics para associar ao cliente e mudar o status para 'used' (simulando a venda)
            const { error: updateError } = await supabase
                .from('wristband_analytics')
                .update({ 
                    client_user_id: userId,
                    status: 'used', // Marcamos como 'used' para indicar que foi vendido/associado
                    event_type: 'purchase',
                    event_data: {
                        purchase_date: new Date().toISOString(),
                        total_paid: price * quantity,
                        unit_price: price,
                        client_id: userId,
                    }
                })
                .in('id', analyticsIdsToUpdate);

            if (updateError) throw updateError;

            // 4. Se a compra for bem-sucedida, invalidamos o cache de ingressos do cliente
            // (Embora não tenhamos um hook para isso, é a melhor prática)
            
            showSuccess(`Compra de ${quantity} ingressos concluída com sucesso!`);
            return true;

        } catch (error: any) {
            console.error("Transaction Error:", error);
            showError(error.message || "Falha na transação de compra. Tente novamente.");
            return false;
        } finally {
            setIsLoading(false);
        }
    };

    return {
        isLoading,
        purchaseTicket,
    };
};
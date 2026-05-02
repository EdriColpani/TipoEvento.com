import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

/**
 * Hook para verificar se o usuário está logado. Se não estiver, 
 * redireciona para a página de login, salvando a rota atual como estado de retorno.
 * 
 * @returns {boolean} isUserAuthenticated - True se o usuário estiver logado.
 */
export const useAuthRedirect = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [isChecking, setIsChecking] = useState(true);
    const [isAuthenticated, setIsAuthenticated] = useState(false);

    useEffect(() => {
        const checkAuth = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            
            if (session) {
                setIsAuthenticated(true);
            } else {
                setIsAuthenticated(false);
            }
            setIsChecking(false);
        };
        checkAuth();
    }, []);

    const redirectToLogin = () => {
        // Salva a rota atual para redirecionar após o login
        navigate('/login', {
            state: { from: `${location.pathname}${location.search}`, eventState: location.state },
        });
    };

    return {
        isChecking,
        isAuthenticated,
        redirectToLogin,
    };
};
import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { readCachedAuthSession } from '@/utils/auth-session-cache';

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
        const cached = readCachedAuthSession();
        setIsAuthenticated(Boolean(cached.accessToken && cached.userId));
        setIsChecking(false);
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
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { supabase } from '@/integrations/supabase/client';
import { showSuccess, showError } from '@/utils/toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const Register: React.FC = () => {
    const navigate = useNavigate();
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        cpf: '',
        birthDate: '',
        gender: '', // Inicializado como string vazia
        password: '',
        confirmPassword: ''
    });
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const [isLoading, setIsLoading] = useState(false);
    const [showSuccessMessage, setShowSuccessMessage] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    const GENDER_OPTIONS = [
        "Masculino",
        "Feminino",
        "Não binário",
        "Outro",
        "Prefiro não dizer"
    ];

    const validateCPF = (cpf: string) => {
        const cleanCPF = cpf.replace(/\D/g, '');
        if (cleanCPF.length !== 11) return false;
        if (/^(\d)\1{10}$/.test(cleanCPF)) return false;
        let sum = 0;
        for (let i = 0; i < 9; i++) {
            sum += parseInt(cleanCPF.charAt(i)) * (10 - i);
        }
        let checkDigit = 11 - (sum % 11);
        if (checkDigit === 10 || checkDigit === 11) checkDigit = 0;
        if (checkDigit !== parseInt(cleanCPF.charAt(9))) return false;
        sum = 0;
        for (let i = 0; i < 10; i++) {
            sum += parseInt(cleanCPF.charAt(i)) * (11 - i);
        }
        checkDigit = 11 - (sum % 11);
        if (checkDigit === 10 || checkDigit === 11) checkDigit = 0;
        if (checkDigit !== parseInt(cleanCPF.charAt(10))) return false;
        return true;
    };

    const formatCPF = (value: string) => {
        const cleanValue = value.replace(/\D/g, '');
        return cleanValue
            .replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d{1,2})/, '$1-$2')
            .replace(/(-\d{2})\d+?$/, '$1');
    };

    const validateForm = () => {
        const errors: { [key: string]: string } = {};
        if (!formData.name.trim()) {
            errors.name = 'Nome é obrigatório';
        } else if (formData.name.trim().length < 2) {
            errors.name = 'Nome deve ter pelo menos 2 caracteres';
        }
        if (!formData.email.trim()) {
            errors.email = 'E-mail é obrigatório';
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
            errors.email = 'E-mail inválido';
        }
        if (!formData.cpf.trim()) {
            errors.cpf = 'CPF é obrigatório';
        } else if (!validateCPF(formData.cpf)) {
            errors.cpf = 'CPF inválido';
        }
        if (!formData.birthDate.trim()) {
            errors.birthDate = 'Data de nascimento é obrigatória';
        } else {
            const today = new Date();
            const birthDate = new Date(formData.birthDate);
            
            if (birthDate > today) {
                errors.birthDate = 'A data de nascimento não pode ser futura';
            }
        }
        if (!formData.password) {
            errors.password = 'Senha é obrigatória';
        } else if (formData.password.length < 6) {
            errors.password = 'Senha deve ter pelo menos 6 caracteres';
        }
        if (!formData.confirmPassword) {
            errors.confirmPassword = 'Confirmação de senha é obrigatória';
        } else if (formData.password !== formData.confirmPassword) {
            errors.confirmPassword = 'As senhas não conferem';
        }
        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleInputChange = (field: string, value: string) => {
        if (field === 'cpf') {
            value = formatCPF(value);
        }
        setFormData(prev => ({ ...prev, [field]: value }));
        if (formErrors[field]) {
            setFormErrors(prev => ({ ...prev, [field]: '' }));
        }
    };

    const handleSelectChange = (field: string, value: string) => {
        // Se o valor for 'not_specified', salvamos como string vazia no estado para representar 'null' no DB
        const finalValue = value === 'not_specified' ? '' : value;
        setFormData(prev => ({ ...prev, [field]: finalValue }));
        if (formErrors[field]) {
            setFormErrors(prev => ({ ...prev, [field]: '' }));
        }
    };

    const translateSupabaseError = (message: string): string => {
        if (message.includes('User already registered')) {
            return 'Já existe uma conta com este e-mail.';
        }
        if (message.includes('Password should be at least 6 characters')) {
            return 'A senha deve ter no mínimo 6 caracteres.';
        }
        return 'Ocorreu um erro ao processar seu cadastro. Tente novamente.';
    };

    const handleSubmitRegistration = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!validateForm()) return;
        setIsLoading(true);

        const cleanCPF = formData.cpf.replace(/\D/g, '');
        // Se o gênero for string vazia, ele será tratado como null pelo trigger do Supabase
        const genderToSave = formData.gender || null; 
        
        try {
            const { data, error } = await supabase.auth.signUp({
                email: formData.email,
                password: formData.password,
                options: {
                    data: {
                        name: formData.name,
                        cpf: cleanCPF,
                        birth_date: formData.birthDate,
                        gender: genderToSave,
                    },
                },
            });

            if (error) {
                showError(translateSupabaseError(error.message));
                setIsLoading(false);
                return;
            }

            if (data.user || data.session) {
                showSuccess("Cadastro realizado! Verifique seu e-mail para ativar sua conta.");
                setShowSuccessMessage(true);
                setTimeout(() => {
                    navigate('/login');
                }, 3000);
            }

        } catch (error) {
            console.error('Erro inesperado no cadastro:', error);
            showError("Ocorreu um erro inesperado. Tente novamente.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center px-4 sm:px-6 py-12">
            <div className="absolute inset-0 opacity-[0.12]">
                <div
                    className="absolute inset-0"
                    style={{
                        backgroundImage:
                            'radial-gradient(circle at 25% 25%, #22d3ee 0%, transparent 50%), radial-gradient(circle at 75% 75%, #3b82f6 0%, transparent 50%)',
                        backgroundSize: '400px 400px',
                    }}
                />
            </div>
            <div className="relative z-10 w-full max-w-sm sm:max-w-md">
                <div className="text-center mb-6 sm:mb-8">
                    <div className="text-3xl font-serif font-bold mb-2 bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-500 bg-clip-text text-transparent">
                        EventFest
                    </div>
                    <h1 className="text-xl sm:text-2xl font-semibold text-white mb-2">Criar Conta</h1>
                    <p className="text-gray-400 text-sm sm:text-base">Junte-se à nossa comunidade premium</p>
                </div>
                <div className="bg-black/80 backdrop-blur-sm border border-cyan-500/30 rounded-2xl p-6 sm:p-8 shadow-2xl shadow-cyan-500/15">
                    {showSuccessMessage ? (
                        <div className="text-center py-8">
                            <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                                <i className="fas fa-check text-green-500 text-2xl"></i>
                            </div>
                            <h3 className="text-xl font-semibold text-white mb-2">Cadastro Realizado!</h3>
                            <p className="text-gray-400 text-sm mb-4">
                                Enviamos um link de verificação para seu e-mail. Verifique sua caixa de entrada para ativar sua conta.
                            </p>
                            <div className="text-sm text-cyan-400">
                                Redirecionando para o login em alguns segundos...
                            </div>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmitRegistration} className="space-y-5 sm:space-y-6">
                            <div>
                                <label htmlFor="name" className="block text-sm font-medium text-white mb-2">
                                    Nome Completo *
                                </label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        id="name"
                                        value={formData.name}
                                        onChange={(e) => handleInputChange('name', e.target.value)}
                                        className={`w-full bg-black/60 border rounded-xl px-4 py-3 text-white placeholder-gray-400 text-sm sm:text-base focus:outline-none focus:ring-2 transition-all duration-300 ${formErrors.name
                                                ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20'
                                                : 'border-cyan-500/30 focus:border-cyan-400 focus:ring-cyan-400/25'
                                            }`}
                                        placeholder="Digite seu nome completo"
                                        maxLength={100}
                                    />
                                    <i className="fas fa-user absolute right-4 top-1/2 transform -translate-y-1/2 text-cyan-400/70 text-sm" aria-hidden></i>
                                </div>
                                {formErrors.name && (
                                    <p className="text-red-400 text-xs sm:text-sm mt-1 flex items-center">
                                        <i className="fas fa-exclamation-circle mr-1"></i>
                                        {formErrors.name}
                                    </p>
                                )}
                            </div>
                            <div>
                                <label htmlFor="email" className="block text-sm font-medium text-white mb-2">
                                    E-mail *
                                </label>
                                <div className="relative">
                                    <input
                                        type="email"
                                        id="email"
                                        value={formData.email}
                                        onChange={(e) => handleInputChange('email', e.target.value)}
                                        className={`w-full bg-black/60 border rounded-xl px-4 py-3 text-white placeholder-gray-400 text-sm sm:text-base focus:outline-none focus:ring-2 transition-all duration-300 ${formErrors.email
                                                ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20'
                                                : 'border-cyan-500/30 focus:border-cyan-400 focus:ring-cyan-400/25'
                                            }`}
                                        placeholder="seu@email.com"
                                        maxLength={100}
                                    />
                                    <i className="fas fa-envelope absolute right-4 top-1/2 transform -translate-y-1/2 text-cyan-400/70 text-sm" aria-hidden></i>
                                </div>
                                {formErrors.email && (
                                    <p className="text-red-400 text-xs sm:text-sm mt-1 flex items-center">
                                        <i className="fas fa-exclamation-circle mr-1"></i>
                                        {formErrors.email}
                                    </p>
                                )}
                            </div>
                            <div>
                                <label htmlFor="cpf" className="block text-sm font-medium text-white mb-2">
                                    CPF *
                                </label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        id="cpf"
                                        value={formData.cpf}
                                        onChange={(e) => handleInputChange('cpf', e.target.value)}
                                        className={`w-full bg-black/60 border rounded-xl px-4 py-3 text-white placeholder-gray-400 text-sm sm:text-base focus:outline-none focus:ring-2 transition-all duration-300 ${formErrors.cpf
                                                ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20'
                                                : 'border-cyan-500/30 focus:border-cyan-400 focus:ring-cyan-400/25'
                                            }`}
                                        placeholder="000.000.000-00"
                                        maxLength={14}
                                    />
                                    <i className="fas fa-id-card absolute right-4 top-1/2 transform -translate-y-1/2 text-cyan-400/70 text-sm" aria-hidden></i>
                                </div>
                                {formErrors.cpf && (
                                    <p className="text-red-400 text-xs sm:text-sm mt-1 flex items-center">
                                        <i className="fas fa-exclamation-circle mr-1"></i>
                                        {formErrors.cpf}
                                    </p>
                                )}
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label htmlFor="birthDate" className="block text-sm font-medium text-white mb-2">
                                        Data de Nascimento *
                                    </label>
                                    <div className="relative">
                                        <input
                                            type="date"
                                            id="birthDate"
                                            value={formData.birthDate}
                                            onChange={(e) => handleInputChange('birthDate', e.target.value)}
                                            className={`w-full bg-black/60 border rounded-xl px-4 py-3 text-white placeholder-gray-400 text-sm sm:text-base focus:outline-none focus:ring-2 transition-all duration-300 ${formErrors.birthDate
                                                    ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20'
                                                    : 'border-cyan-500/30 focus:border-cyan-400 focus:ring-cyan-400/25'
                                                }`}
                                        />
                                        <i className="fas fa-calendar-alt absolute right-4 top-1/2 transform -translate-y-1/2 text-cyan-400/70 text-sm" aria-hidden></i>
                                    </div>
                                    {formErrors.birthDate && (
                                        <p className="text-red-400 text-xs sm:text-sm mt-1 flex items-center">
                                            <i className="fas fa-exclamation-circle mr-1"></i>
                                            {formErrors.birthDate}
                                        </p>
                                    )}
                                </div>
                                <div>
                                    <label htmlFor="gender" className="block text-sm font-medium text-white mb-2">
                                        Gênero (Opcional)
                                    </label>
                                    <Select onValueChange={(value) => handleSelectChange('gender', value)} value={formData.gender || 'not_specified'}>
                                        <SelectTrigger 
                                            className={`w-full bg-black/60 border rounded-xl px-4 py-3 h-auto min-h-[48px] text-white text-sm sm:text-base focus:ring-2 transition-all duration-300 [&_svg]:text-cyan-400 [&_svg]:opacity-90 ${formErrors.gender
                                                ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20'
                                                : 'border-cyan-500/30 focus:border-cyan-400 focus:ring-cyan-400/25'
                                            }`}
                                        >
                                            <SelectValue placeholder="Selecione seu gênero" />
                                        </SelectTrigger>
                                        <SelectContent className="bg-black border-cyan-500/30 text-white">
                                            <SelectItem value="not_specified" className="text-gray-500">
                                                Não especificado
                                            </SelectItem>
                                            {GENDER_OPTIONS.map(option => (
                                                <SelectItem key={option} value={option} className="hover:bg-cyan-500/15 focus:bg-cyan-500/15 cursor-pointer">
                                                    {option}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    {formErrors.gender && (
                                        <p className="text-red-400 text-xs sm:text-sm mt-1 flex items-center">
                                            <i className="fas fa-exclamation-circle mr-1"></i>
                                            {formErrors.gender}
                                        </p>
                                    )}
                                </div>
                            </div>

                            <div>
                                <label htmlFor="password" className="block text-sm font-medium text-white mb-2">
                                    Senha *
                                </label>
                                <div className="relative">
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        id="password"
                                        value={formData.password}
                                        onChange={(e) => handleInputChange('password', e.target.value)}
                                        className={`w-full bg-black/60 border rounded-xl px-4 py-3 text-white placeholder-gray-400 text-sm sm:text-base focus:outline-none focus:ring-2 transition-all duration-300 ${formErrors.password
                                                ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20'
                                                : 'border-cyan-500/30 focus:border-cyan-400 focus:ring-cyan-400/25'
                                            }`}
                                        placeholder="Mínimo 6 caracteres"
                                        maxLength={50}
                                    />
                                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 transform -translate-y-1/2 text-cyan-400/70 hover:text-cyan-300 transition-colors">
                                        <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                                    </button>
                                </div>
                                {formErrors.password && (
                                    <p className="text-red-400 text-xs sm:text-sm mt-1 flex items-center">
                                        <i className="fas fa-exclamation-circle mr-1"></i>
                                        {formErrors.password}
                                    </p>
                                )}
                            </div>
                            <div>
                                <label htmlFor="confirmPassword" className="block text-sm font-medium text-white mb-2">
                                    Confirmar Senha *
                                </label>
                                <div className="relative">
                                    <input
                                        type={showConfirmPassword ? 'text' : 'password'}
                                        id="confirmPassword"
                                        value={formData.confirmPassword}
                                        onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                                        className={`w-full bg-black/60 border rounded-xl px-4 py-3 text-white placeholder-gray-400 text-sm sm:text-base focus:outline-none focus:ring-2 transition-all duration-300 ${formErrors.confirmPassword
                                                ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20'
                                                : 'border-cyan-500/30 focus:border-cyan-400 focus:ring-cyan-400/25'
                                            }`}
                                        placeholder="Repita sua senha"
                                        maxLength={50}
                                    />
                                    <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-4 top-1/2 transform -translate-y-1/2 text-cyan-400/70 hover:text-cyan-300 transition-colors">
                                        <i className={`fas ${showConfirmPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                                    </button>
                                </div>
                                {formErrors.confirmPassword && (
                                    <p className="text-red-400 text-xs sm:text-sm mt-1 flex items-center">
                                        <i className="fas fa-exclamation-circle mr-1"></i>
                                        {formErrors.confirmPassword}
                                    </p>
                                )}
                            </div>
                            <div className="flex items-start space-x-3">
                                <input
                                    type="checkbox"
                                    id="terms"
                                    required
                                    className="mt-1 h-4 w-4 accent-[#22d3ee] focus:outline-none focus:ring-2 focus:ring-cyan-400/50 focus:ring-offset-2 focus:ring-offset-black/80"
                                    style={{ accentColor: '#22d3ee' }}
                                />
                                <label htmlFor="terms" className="text-xs sm:text-sm text-gray-300">
                                    Li e aceito os{' '}
                                    <a href="#" className="text-cyan-400 hover:text-cyan-300 underline">
                                        Termos de Uso
                                    </a>{' '}
                                    e{' '}
                                    <a href="#" className="text-cyan-400 hover:text-cyan-300 underline">
                                        Política de Privacidade
                                    </a>
                                </label>
                            </div>
                            <div className="space-y-4">
                                <Button
                                    type="submit"
                                    disabled={isLoading}
                                    className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-black hover:from-cyan-400 hover:to-blue-500 py-3 text-base sm:text-lg font-semibold transition-all duration-300 cursor-pointer hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                                >
                                    {isLoading ? (
                                        <div className="flex items-center justify-center">
                                            <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin mr-2"></div>
                                            Criando conta...
                                        </div>
                                    ) : (
                                        'Criar Conta'
                                    )}
                                </Button>
                                <Button
                                    type="button"
                                    onClick={() => navigate('/')}
                                    className="w-full bg-transparent border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 py-3 text-base sm:text-lg font-semibold transition-all duration-300 cursor-pointer"
                                >
                                    Voltar
                                </Button>
                            </div>
                            <div className="text-center pt-4 border-t border-cyan-500/25">
                                <p className="text-gray-400 text-sm">
                                    Já tem uma conta?{' '}
                                    <button
                                        type="button"
                                        onClick={() => navigate('/login')}
                                        className="text-cyan-400 hover:text-cyan-300 font-semibold transition-colors cursor-pointer"
                                    >
                                        Fazer Login
                                    </button>
                                </p>
                            </div>
                        </form>
                    )}
                </div>
                <div className="mt-6 p-4 bg-black/40 rounded-xl border border-cyan-500/25">
                    <div className="flex items-center text-cyan-400 mb-2">
                        <i className="fas fa-shield-alt mr-2"></i>
                        <span className="text-sm font-semibold">Seus dados estão seguros</span>
                    </div>
                    <p className="text-gray-400 text-xs leading-relaxed">
                        Utilizamos criptografia de ponta e nunca compartilhamos suas informações pessoais.
                        Sua conta será ativada após a verificação do e-mail.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Register;
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { User } from 'lucide-react';

const ManagerIndividualRegister: React.FC = () => {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center px-4 sm:px-6 py-12">
            <div className="absolute inset-0 opacity-10">
                <div className="absolute inset-0" style={{
                    backgroundImage: 'radial-gradient(circle at 25% 25%, #fbbf24 0%, transparent 50%), radial-gradient(circle at 75% 75%, #fbbf24 0%, transparent 50%)',
                    backgroundSize: '400px 400px'
                }}></div>
            </div>
            <div className="relative z-10 w-full max-w-sm sm:max-w-md">
                <div className="text-center mb-6 sm:mb-8">
                    <div className="text-3xl font-serif text-yellow-500 font-bold mb-2">
                        EventoFest PRO
                    </div>
                    <h1 className="text-xl sm:text-2xl font-semibold text-white mb-2">Cadastro de Gestor (Pessoa Física)</h1>
                    <p className="text-gray-400 text-sm sm:text-base">Preencha seus dados para se tornar um gestor individual.</p>
                </div>
                <Card className="bg-black/80 backdrop-blur-sm border border-yellow-500/30 rounded-2xl p-6 sm:p-8 shadow-2xl shadow-yellow-500/10">
                    <CardHeader className="text-center">
                        <User className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
                        <CardTitle className="text-white text-xl">Formulário de Registro</CardTitle>
                        <CardDescription className="text-gray-400">
                            Este é um placeholder. O formulário completo será implementado aqui.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Button
                            onClick={() => navigate('/manager/dashboard')}
                            className="w-full bg-yellow-500 text-black hover:bg-yellow-600 py-3 text-base sm:text-lg font-semibold transition-all duration-300 cursor-pointer"
                        >
                            Ir para o Dashboard (Simulação)
                        </Button>
                        <Button
                            onClick={() => navigate('/')}
                            variant="outline"
                            className="w-full bg-transparent border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 py-3 text-base sm:text-lg font-semibold transition-all duration-300 cursor-pointer"
                        >
                            Voltar para a Home
                        </Button>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

export default ManagerIndividualRegister;
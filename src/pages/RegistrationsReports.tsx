import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ClipboardList, Search, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/hooks/use-profile';
import { showError, showSuccess } from '@/utils/toast';

interface EventForFilter {
  id: string;
  title: string;
}

interface RegistrationRow {
  id: string;
  event_id: string;
  event_title: string;
  full_name: string;
  cpf: string;
  city: string;
  state: string;
  phone: string;
  email: string;
  confirmed: boolean;
  created_at: string;
}

const fetchEventsForFilter = async (): Promise<EventForFilter[]> => {
  const { data, error } = await supabase
    .from('events')
    .select('id, title')
    .order('title', { ascending: true });
  if (error) throw error;
  return data;
};

const fetchRegistrations = async (eventId: string | null, search: string): Promise<RegistrationRow[]> => {
  let query = supabase
    .from('event_registrations')
    .select('id, event_id, full_name, cpf, city, state, phone, email, confirmed, created_at, events(title)')
    .order('created_at', { ascending: false });

  if (eventId) {
    query = query.eq('event_id', eventId);
  }

  const { data, error } = await query;
  if (error) throw error;

  let rows = (data || []).map((row: any) => ({
    id: row.id,
    event_id: row.event_id,
    event_title: row.events?.title ?? 'Evento',
    full_name: row.full_name,
    cpf: row.cpf,
    city: row.city,
    state: row.state,
    phone: row.phone,
    email: row.email,
    confirmed: row.confirmed ?? false,
    created_at: row.created_at,
  })) as RegistrationRow[];

  if (search.trim()) {
    const term = search.toLowerCase();
    rows = rows.filter((r) =>
      r.full_name.toLowerCase().includes(term) ||
      r.cpf.toLowerCase().includes(term) ||
      r.email.toLowerCase().includes(term),
    );
  }

  return rows;
};

const RegistrationsReports: React.FC = () => {
  const navigate = useNavigate();
  const { profile } = useProfile();
  const [selectedEventId, setSelectedEventId] = useState<string | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  if (profile && profile.tipo_usuario_id !== 1 && profile.tipo_usuario_id !== 2) {
    return (
      <div className="max-w-7xl mx-auto text-center py-20">
        <h1 className="text-3xl font-serif text-red-500 mb-4">Acesso Negado</h1>
        <p className="text-gray-400">Você não tem permissão para acessar esta página.</p>
        <Button
          onClick={() => navigate('/manager/dashboard')}
          className="mt-4 bg-yellow-500 text-black hover:bg-yellow-600"
        >
          Voltar para o Dashboard
        </Button>
      </div>
    );
  }

  const { data: events, isLoading: isLoadingEvents } = useQuery<EventForFilter[]>({
    queryKey: ['registration_report_events'],
    queryFn: fetchEventsForFilter,
  });

  const { data: registrations, isLoading: isLoadingRegistrations } = useQuery<RegistrationRow[]>({
    queryKey: ['registration_reports', selectedEventId, searchTerm],
    queryFn: () => fetchRegistrations(selectedEventId === 'all' ? null : selectedEventId, searchTerm),
  });

  const handleExportCsv = () => {
    if (!registrations || registrations.length === 0) {
      showError('Nenhum dado para exportar.');
      return;
    }

    const header = [
      'Evento',
      'Nome Completo',
      'CPF',
      'Cidade',
      'Estado',
      'Telefone',
      'E-mail',
      'Confirmado',
      'Data Inscrição',
    ];

    const rows = registrations.map((r) => [
      `"${r.event_title.replace(/"/g, '""')}"`,
      `"${r.full_name.replace(/"/g, '""')}"`,
      `"${r.cpf}"`,
      `"${r.city}"`,
      `"${r.state}"`,
      `"${r.phone}"`,
      `"${r.email}"`,
      r.confirmed ? 'Sim' : 'Não',
      `"${new Date(r.created_at).toLocaleString('pt-BR')}"`,
    ]);

    const csvContent = [header, ...rows].map((r) => r.join(';')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'relatorio_inscricoes.csv';
    link.click();
    URL.revokeObjectURL(url);

    showSuccess('CSV exportado com sucesso.');
  };

  const filteredEvents = events || [];

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center">
            <ClipboardList className="h-7 w-7 mr-3" />
            Relatório de Inscrições
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Lista de participantes inscritos por evento, com coluna de confirmação para futuras impressões e controle de presença.
          </p>
        </div>
        <Button
          onClick={() => navigate('/manager/reports')}
          variant="outline"
          className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 text-sm"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar à Central
        </Button>
      </div>

      <Card className="bg-black border border-yellow-500/30 rounded-2xl mb-6">
        <CardHeader className="p-6 pb-2">
          <CardTitle className="text-white text-lg">Filtros</CardTitle>
          <CardDescription className="text-gray-400 text-sm">
            Selecione o evento e faça buscas por nome, CPF ou e-mail.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-6 pb-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
            <div>
              <label className="block text-sm font-medium text-white mb-1">Evento</label>
              <Select
                value={selectedEventId}
                onValueChange={(value) => setSelectedEventId(value as any)}
              >
                <SelectTrigger className="bg-black/60 border border-yellow-500/30 text-white">
                  <SelectValue placeholder="Todos os eventos" />
                </SelectTrigger>
                <SelectContent className="bg-black border border-yellow-500/30 text-white">
                  <SelectItem value="all">Todos os eventos</SelectItem>
                  {!isLoadingEvents &&
                    filteredEvents.map((event) => (
                      <SelectItem key={event.id} value={event.id}>
                        {event.title}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-white mb-1">Buscar</label>
              <div className="relative">
                <Input
                  placeholder="Nome, CPF ou e-mail"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="bg-black/60 border border-yellow-500/30 text-white pl-10"
                />
                <Search className="h-4 w-4 text-yellow-500 absolute left-3 top-1/2 -translate-y-1/2" />
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              variant="outline"
              className="border-yellow-500/40 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/15 text-sm"
              onClick={handleExportCsv}
            >
              <Download className="h-4 w-4 mr-2" />
              Exportar CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-black border border-yellow-500/30 rounded-2xl">
        <CardHeader className="p-6 pb-3">
          <CardTitle className="text-white text-lg">Participantes inscritos</CardTitle>
          <CardDescription className="text-gray-400 text-sm">
            Visualização por evento com coluna de confirmação (somente leitura por enquanto).
          </CardDescription>
        </CardHeader>
        <CardContent className="px-6 pb-6">
          <div className="overflow-x-auto rounded-xl border border-yellow-500/20">
            <Table>
              <TableHeader className="bg-black/60">
                <TableRow>
                  <TableHead className="text-yellow-500">Evento</TableHead>
                  <TableHead className="text-yellow-500">Nome completo</TableHead>
                  <TableHead className="text-yellow-500">CPF</TableHead>
                  <TableHead className="text-yellow-500">Cidade/UF</TableHead>
                  <TableHead className="text-yellow-500">Telefone</TableHead>
                  <TableHead className="text-yellow-500">E-mail</TableHead>
                  <TableHead className="text-yellow-500 text-center">Confirmado</TableHead>
                  <TableHead className="text-yellow-500">Data inscrição</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingRegistrations ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-6 text-gray-400">
                      Carregando inscrições...
                    </TableCell>
                  </TableRow>
                ) : registrations && registrations.length > 0 ? (
                  registrations.map((r) => (
                    <TableRow key={r.id} className="hover:bg-yellow-500/5">
                      <TableCell className="text-white">{r.event_title}</TableCell>
                      <TableCell className="text-white">{r.full_name}</TableCell>
                      <TableCell className="text-gray-300">{r.cpf}</TableCell>
                      <TableCell className="text-gray-300">
                        {r.city} / {r.state}
                      </TableCell>
                      <TableCell className="text-gray-300">{r.phone}</TableCell>
                      <TableCell className="text-gray-300">{r.email}</TableCell>
                      <TableCell className="text-center">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-semibold ${
                            r.confirmed
                              ? 'bg-green-500/20 text-green-400 border border-green-500/40'
                              : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/30'
                          }`}
                        >
                          {r.confirmed ? 'Confirmado' : 'Pendente'}
                        </span>
                      </TableCell>
                      <TableCell className="text-gray-300">
                        {new Date(r.created_at).toLocaleString('pt-BR')}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-6 text-gray-400">
                      Nenhuma inscrição encontrada para os filtros selecionados.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default RegistrationsReports;


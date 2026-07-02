import React, { useState } from 'react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Mail, Trash2 } from 'lucide-react';
import type { AdminCompanyBillingRow } from '@/hooks/use-admin-companies-billing';
import { adminBtnOutline } from '@/constants/billing-ui';
import {
    adminDeletePartnerCompany,
    fetchPartnerOwnerInviteEmail,
} from '@/utils/company-members';
import { sendPartnerOwnerInviteEmail } from '@/utils/partner-owner-invite';
import { dismissToast, showError, showLoading, showSuccess } from '@/utils/toast';

type AdminPartnerCompanyActionsProps = {
    company: AdminCompanyBillingRow;
    onChanged: () => void;
};

const AdminPartnerCompanyActions: React.FC<AdminPartnerCompanyActionsProps> = ({
    company,
    onChanged,
}) => {
    const [sendingInvite, setSendingInvite] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [ownerEmail, setOwnerEmail] = useState('');

    const companyLabel =
        company.trade_name?.trim() || company.corporate_name?.trim() || 'Empresa parceira';

    const openInviteDialog = async () => {
        const preset =
            (await fetchPartnerOwnerInviteEmail(company.id)) ||
            company.email?.trim().toLowerCase() ||
            '';
        setOwnerEmail(preset);
        setInviteDialogOpen(true);
    };

    const handleSendInvite = async () => {
        const normalizedEmail = ownerEmail.trim().toLowerCase();
        if (!normalizedEmail || !normalizedEmail.includes('@')) {
            showError('Informe um e-mail válido do gestor.');
            return;
        }

        setSendingInvite(true);
        const loadingToast = showLoading('Enviando convite ao gestor...');
        try {
            const result = await sendPartnerOwnerInviteEmail({
                companyId: company.id,
                ownerEmail: normalizedEmail,
                companyName: companyLabel,
            });
            if (!result.ok) {
                throw new Error(result.message);
            }
            showSuccess(result.message || 'Convite enviado ao gestor.');
            setInviteDialogOpen(false);
            onChanged();
        } catch (err: unknown) {
            showError(err instanceof Error ? err.message : 'Falha ao enviar convite.');
        } finally {
            dismissToast(loadingToast);
            setSendingInvite(false);
        }
    };

    const handleDelete = async () => {
        setDeleting(true);
        const loadingToast = showLoading(`Excluindo "${companyLabel}"...`);
        try {
            await adminDeletePartnerCompany(company.id);
            showSuccess(`Empresa parceira "${companyLabel}" excluída.`);
            setDeleteDialogOpen(false);
            onChanged();
        } catch (err: unknown) {
            showError(err instanceof Error ? err.message : 'Falha ao excluir empresa parceira.');
        } finally {
            dismissToast(loadingToast);
            setDeleting(false);
        }
    };

    return (
        <>
            <div className="flex flex-col sm:flex-row gap-1 justify-end">
                <Button
                    type="button"
                    size="sm"
                    className={adminBtnOutline}
                    disabled={sendingInvite || deleting}
                    onClick={() => void openInviteDialog()}
                >
                    {sendingInvite ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <>
                            <Mail className="h-4 w-4 mr-1" />
                            Enviar convite
                        </>
                    )}
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={sendingInvite || deleting}
                    onClick={() => setDeleteDialogOpen(true)}
                    className="bg-red-950/40 border border-red-500/40 text-red-400 hover:bg-red-500/15 hover:text-red-300 disabled:opacity-50"
                >
                    {deleting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <>
                            <Trash2 className="h-4 w-4 mr-1" />
                            Excluir
                        </>
                    )}
                </Button>
            </div>

            <AlertDialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
                <AlertDialogContent className="bg-black/95 border border-yellow-500/30 text-white max-w-md">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-yellow-500">
                            Enviar convite ao gestor
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-gray-400">
                            O gestor receberá um e-mail com link para criar a senha (conta nova) ou
                            entrar na EventFest (conta existente).
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="grid gap-2 py-2">
                        <Label className="text-gray-300">E-mail do gestor</Label>
                        <Input
                            type="email"
                            value={ownerEmail}
                            onChange={(e) => setOwnerEmail(e.target.value)}
                            placeholder="gestor@empresa.com"
                            className="bg-black/60 border-yellow-500/30 text-white"
                        />
                        <p className="text-xs text-gray-500">
                            Empresa: <span className="text-gray-300">{companyLabel}</span>
                        </p>
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel className={adminBtnOutline}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => {
                                e.preventDefault();
                                void handleSendInvite();
                            }}
                            disabled={sendingInvite}
                            className="bg-yellow-500 text-black hover:bg-yellow-600"
                        >
                            {sendingInvite ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                'Enviar e-mail'
                            )}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent className="bg-black/95 border border-red-500/30 text-white max-w-md">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-red-400">Excluir empresa parceira?</AlertDialogTitle>
                        <AlertDialogDescription className="text-gray-400">
                            Esta ação não pode ser desfeita. A empresa{' '}
                            <span className="font-semibold text-white">"{companyLabel}"</span> será
                            removida junto com convites pendentes.
                            <span className="block mt-2 text-amber-300/90 text-sm">
                                Só é permitido se o gestor ainda não confirmou o plano e não há
                                eventos cadastrados.
                            </span>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className={adminBtnOutline}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => {
                                e.preventDefault();
                                void handleDelete();
                            }}
                            disabled={deleting}
                            className="bg-red-600 text-white hover:bg-red-700"
                        >
                            {deleting ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                'Excluir empresa'
                            )}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};

export default AdminPartnerCompanyActions;

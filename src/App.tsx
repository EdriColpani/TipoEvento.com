import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import EventDetails from "./pages/EventDetails";
import Register from "./pages/Register";
import Login from "./pages/Login";
import Profile from "./pages/Profile";
import MyTickets from "./pages/MyTickets";
import ManagerLogin from "./pages/ManagerLogin";
import ManagerDashboard from "./pages/ManagerDashboard";
import ManagerCreateEvent from "./pages/ManagerCreateEvent";
import ManagerEventsList from "./pages/ManagerEventsList";
import ManagerEditEvent from "./pages/ManagerEditEvent";
import ManagerSettings from "./pages/ManagerSettings";
import ManagerCompanyProfile from "./pages/ManagerCompanyProfile";
import ManagerNotifications from "./pages/ManagerNotifications";
import ManagerAdvancedSettings from "./pages/ManagerAdvancedSettings";
import ManagerDatabaseBackup from "./pages/ManagerDatabaseBackup"; 
import ManagerPaymentSettings from "./pages/ManagerPaymentSettings"; 
import ManagerCreateWristband from "./pages/ManagerCreateWristband"; 
import ManagerWristbandsList from "./pages/ManagerWristbandsList"; 
import ManagerManageWristband from "./pages/ManagerManageWristband";
import ManagerReports from "./pages/ManagerReports";
import FinancialReports from "./pages/FinancialReports";
import EventTicketDetailsPage from "./pages/EventTicketDetailsPage";
import EventInscriptionPage from "./pages/EventInscriptionPage";
import EventInscriptionSuccessPage from "./pages/EventInscriptionSuccessPage";
import AdminDashboard from "./pages/AdminDashboard";
import AdminRouteGuard from "./components/AdminRouteGuard";
import AdminMasterRouteGuard from "./components/AdminMasterRouteGuard";
import ManagerLayout from "./components/layouts/ManagerLayout";
import ClientLayout from "./components/layouts/ClientLayout"; // Import ClientLayout
import ForgotPassword from "./pages/ForgotPassword";
import ManagerRegister from "./pages/ManagerRegister"; 
import ManagerIndividualProfile from "./pages/ManagerIndividualProfile";
import ManagerCompanyRegister from "./pages/ManagerCompanyRegister"; 
import AdminCarouselSettings from "./pages/AdminCarouselSettings"; 
import AdminCreatePromotionalBanner from "./pages/AdminCreatePromotionalBanner"; 
import AdminPromotionalBannersList from "./pages/AdminPromotionalBannersList"; 
import AdminEditPromotionalBanner from "./pages/AdminEditPromotionalBanner"; 
import ManagerCreateEventBanner from "./pages/ManagerCreateEventBanner"; 
import ManagerSettingsHistory from "./pages/ManagerSettingsHistory"; 
import AdminCommissionTiers from "./pages/AdminCommissionTiers"; 
import AdminEventContracts from "./pages/AdminEventContracts"; // NOVO
import SalesReports from "./pages/SalesReports"; // NOVO
import EventReports from "./pages/EventsReports"; // NOVO
import AudienceReports from "./pages/AudienceReports"; // NOVO
import ManagerValidationKeys from "./pages/ManagerValidationKeys"; // NOVO
import TicketValidator from "./pages/TicketValidator"; // NOVO
import RegistrationsReports from "./pages/RegistrationsReports";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* Public/Client Routes */}
          <Route path="/" element={<ClientLayout />}> {/* Wrap client routes with ClientLayout */}
            <Route index element={<Index />} />
            <Route path="events/:id" element={<EventDetails />} />
            <Route path="events/:eventId/inscricao" element={<EventInscriptionPage />} />
            <Route path="events/:eventId/inscricao/sucesso" element={<EventInscriptionSuccessPage />} />
            <Route path="register" element={<Register />} />
            <Route path="login" element={<Login />} />
            <Route path="forgot-password" element={<ForgotPassword />} />
            <Route path="profile" element={<Profile />} />
            <Route path="tickets" element={<MyTickets />} />
          </Route>

          {/* Public Validator Route - Não requer autenticação */}
          <Route path="/validator" element={<TicketValidator />} />
          <Route path="/validador" element={<TicketValidator />} />
          
          {/* Manager Login (outside layout for specific styling) */}
          <Route path="/manager/login" element={<ManagerLogin />} />
          
          {/* Manager Registration Routes (Accessible by logged-in clients) */}
          <Route path="/manager/register" element={<ManagerRegister />} />
          {/* Rota de registro individual removida, pois agora é um modal */}
          <Route path="/manager/register/company" element={<ManagerCompanyRegister />} />
          
          {/* Manager Routes (Protected by ManagerLayout, which handles auth/redirect) */}
          <Route element={<ManagerLayout />}>
            <Route path="/manager/dashboard" element={<ManagerDashboard />} />
            <Route path="/manager/events" element={<ManagerEventsList />} />
            <Route path="/manager/events/create" element={<ManagerCreateEvent />} />
            <Route path="/manager/events/edit/:id" element={<ManagerEditEvent />} />
            <Route path="/manager/events/banners/create" element={<ManagerCreateEventBanner />} /> 
            <Route path="/manager/wristbands" element={<ManagerWristbandsList />} />
            <Route path="/manager/wristbands/create" element={<ManagerCreateWristband />} /> 
            <Route path="/manager/wristbands/manage/:id" element={<ManagerManageWristband />} />
            <Route path="/manager/reports" element={<ManagerReports />} />
            <Route path="/manager/reports/financial" element={<FinancialReports />} />
            <Route path="/manager/reports/financial/:eventId/:eventName" element={<EventTicketDetailsPage />} />
            <Route path="/manager/reports/sales" element={<SalesReports />} />
            <Route path="/manager/reports/events" element={<EventReports />} />
            <Route path="/manager/reports/audience" element={<AudienceReports />} />
            <Route path="/manager/reports/registrations" element={<RegistrationsReports />} />
            <Route path="/manager/validation-keys" element={<ManagerValidationKeys />} />
            <Route path="/manager/settings" element={<ManagerSettings />} />
            <Route path="/manager/settings/company-profile" element={<ManagerCompanyProfile />} />
            <Route path="/manager/settings/individual-profile" element={<ManagerIndividualProfile />} />
            <Route path="/manager/settings/notifications" element={<ManagerNotifications />} />
            <Route path="/manager/settings/payment" element={<ManagerPaymentSettings />} />
            <Route path="/manager/settings/history" element={<ManagerSettingsHistory />} />
          </Route>
          
          {/* Admin Master Routes (tipo_usuario_id = 1) */}
          <Route element={<AdminMasterRouteGuard />}>
            <Route element={<ManagerLayout />}>
                <Route path="/admin/dashboard" element={<AdminDashboard />} />
                <Route path="/admin/settings/carousel" element={<AdminCarouselSettings />} />
                <Route path="/admin/settings/commission-tiers" element={<AdminCommissionTiers />} /> 
                <Route path="/admin/settings/contracts" element={<AdminEventContracts />} /> {/* NOVO */}
                <Route path="/admin/banners" element={<AdminPromotionalBannersList />} /> 
                <Route path="/admin/banners/create" element={<AdminCreatePromotionalBanner />} />
                <Route path="/admin/banners/edit/:id" element={<AdminEditPromotionalBanner />} /> 
                <Route path="/manager/settings/advanced" element={<ManagerAdvancedSettings />} />
                <Route path="/manager/settings/backup-database" element={<ManagerDatabaseBackup />} />
            </Route>
          </Route>

          {/* Admin Routes (Protected by AdminRouteGuard) */}
          <Route element={<AdminRouteGuard />}>
            <Route element={<ManagerLayout />}>
                <Route path="/admin/dashboard" element={<AdminDashboard />} />
            </Route>
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
import React from 'react';
import { Outlet } from 'react-router-dom';

/** Cadastros públicos liberados — pré-lançamento desativado. */
const PublicLaunchRegistrationGuard: React.FC = () => <Outlet />;

export default PublicLaunchRegistrationGuard;

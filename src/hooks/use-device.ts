import { useState, useEffect } from 'react';

/** Breakpoints (px) alinhados ao Tailwind: md=768, lg=1024 */
const BREAKPOINT_MOBILE = 768;
const BREAKPOINT_TABLET = 1024;

export type DeviceType = 'mobile' | 'tablet' | 'desktop';

function getDeviceType(width: number): DeviceType {
  if (width < BREAKPOINT_MOBILE) return 'mobile';
  if (width < BREAKPOINT_TABLET) return 'tablet';
  return 'desktop';
}

/**
 * Detecta se o acesso é por celular, tablet ou computador com base na largura da tela.
 * Atualiza ao redimensionar (ex.: rotação do celular).
 */
export function useDevice(): {
  device: DeviceType;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  width: number;
} {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 1024 : window.innerWidth
  );

  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const device = getDeviceType(width);
  return {
    device,
    isMobile: device === 'mobile',
    isTablet: device === 'tablet',
    isDesktop: device === 'desktop',
    width,
  };
}

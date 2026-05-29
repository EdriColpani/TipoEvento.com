import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Botão outline legível em fundos escuros (evita bg branco do tema + texto claro). */
export const outlineBtnDarkClass =
  "border-yellow-500/30 bg-black/60 text-white hover:bg-yellow-500/10 hover:text-yellow-500 no-underline";

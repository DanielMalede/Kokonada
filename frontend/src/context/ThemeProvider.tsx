import type { ReactNode } from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

/**
 * Thin wrapper around next-themes. Toggles the `.dark` class on <html>,
 * persists the choice to localStorage('koko-theme'), and defaults to the
 * user's OS preference. Drives both our token system and the Sonner toaster.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="koko-theme"
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}

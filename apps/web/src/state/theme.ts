import { create } from 'zustand';

export type ThemePreference = 'dark' | 'light' | 'system';

const STORAGE_KEY = 'apion.theme';

/**
 * DESIGN.md sets dark as the default and requires light to work equally well.
 * The preference persists per person and follows the OS on a first visit.
 */
interface ThemeState {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light' || stored === 'system')
      return stored;
  } catch {
    // Storage can be unavailable; the default below still gives a usable theme.
  }
  return 'system';
}

function resolve(preference: ThemePreference): 'dark' | 'light' {
  if (preference !== 'system') return preference;
  // Dark is the product default, so `system` only becomes light when the OS
  // explicitly asks for it.
  return globalThis.matchMedia?.('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

/**
 * The stylesheet keys light off `[data-theme='light']` and treats everything
 * else as dark, so only the resolved value is written to the element.
 */
function apply(preference: ThemePreference): void {
  document.documentElement.dataset['theme'] = resolve(preference);
}

export const useTheme = create<ThemeState>((set) => ({
  preference: readPreference(),
  setPreference: (preference) => {
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // A theme that cannot be remembered is still a theme for this session.
    }
    apply(preference);
    set({ preference });
  },
}));

/** Called once at startup, before React renders, to avoid a flash of dark. */
export function initialiseTheme(): void {
  apply(readPreference());

  globalThis
    .matchMedia?.('(prefers-color-scheme: light)')
    .addEventListener('change', () => {
      if (useTheme.getState().preference === 'system') {
        apply('system');
      }
    });
}

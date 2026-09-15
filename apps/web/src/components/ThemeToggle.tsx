import { type ThemePreference, useTheme } from '../state/theme.js';

const ORDER: ThemePreference[] = ['system', 'dark', 'light'];

const LABELS: Record<ThemePreference, string> = {
  system: 'Match system',
  dark: 'Dark',
  light: 'Light',
};

/**
 * Both themes are first-class (R-34, DESIGN.md), so this cycles rather than
 * flipping a boolean: `system` is a real third choice, not the absence of one.
 */
export function ThemeToggle() {
  const preference = useTheme((state) => state.preference);
  const setPreference = useTheme((state) => state.setPreference);

  const next = ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length];

  return (
    <button
      type="button"
      className="min-h-8 cursor-pointer whitespace-nowrap rounded-md border border-line-control px-3 text-sm text-text-muted hover:bg-surface-2 hover:text-text"
      onClick={() => setPreference(next)}
      // The label states the current value and what pressing it does, so a
      // screen-reader user is not left guessing at a cycling control.
      aria-label={`Theme: ${LABELS[preference]}. Switch to ${LABELS[next]}.`}
    >
      {LABELS[preference]}
    </button>
  );
}

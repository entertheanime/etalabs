'use client';

import { useTheme } from '../context/ThemeContext';

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const night = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="rounded-full px-3 py-1.5 text-[12px] text-subtle hover:text-ink"
      aria-label={night ? 'Switch to day mode' : 'Switch to night mode'}
      title={night ? 'Day mode' : 'Night mode'}
    >
      {night ? 'Day' : 'Night'}
    </button>
  );
}

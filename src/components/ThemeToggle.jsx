import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../lib/theme';

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const toDark = theme !== 'dark';
  const label = toDark ? 'Switch to dark mode' : 'Switch to light mode';
  return (
    <button type="button" className="icon-btn theme-toggle" onClick={toggle} aria-label={label} title={label}>
      {toDark ? <Moon size={17} /> : <Sun size={17} />}
    </button>
  );
}

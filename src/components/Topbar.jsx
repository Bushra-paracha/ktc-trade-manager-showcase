import { useEffect, useState } from 'react';
import { Bell, Command, Plus, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import GlobalSearch from './GlobalSearch';
import ThemeToggle from './ThemeToggle';
import { useAuth } from '../hooks/useAuth';

export default function Topbar() {
  const [searchOpen, setSearchOpen] = useState(false);
  const { canEdit } = useAuth();

  useEffect(() => {
    const onKeyDown = (event) => {
      const isShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      if (!isShortcut) return;
      event.preventDefault();
      setSearchOpen(true);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      <header className="topbar">
        <div className="topbar-brand">
          <div className="topbar-brand-mark">KTC</div>
          <div>
            <strong>Trade Manager</strong>
            <span>International Export CRM</span>
          </div>
        </div>
        <div className="topbar-actions">
          <button type="button" className="topbar-search" onClick={() => setSearchOpen(true)} aria-label="Open global search">
            <Search size={16} />
            <span>Search anything…</span>
            <kbd><Command size={12} /> K</kbd>
          </button>
          {canEdit && (
            <Link to="/clients" className="topbar-create">
              <Plus size={16} />
              New buyer
            </Link>
          )}
          <ThemeToggle />
          <button className="icon-btn" aria-label="Notifications">
            <Bell size={17} />
          </button>
        </div>
      </header>
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}

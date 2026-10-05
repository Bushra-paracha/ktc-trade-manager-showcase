import { NavLink, useLocation } from 'react-router-dom';
import { LogOut, Sparkles } from 'lucide-react';
import { navGroups, visibleNavItems } from '../data/navItems';
import { useAuth } from '../hooks/useAuth';

function initialsFrom(name, email) {
  if (name) {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }
  if (email) return email[0].toUpperCase();
  return '?';
}

function isGroupActive(group, pathname) {
  return group.items.some((item) => (item.to === '/' ? pathname === '/' : pathname.startsWith(item.to)));
}

export default function Sidebar() {
  const { user, profile, signOut, isDirector } = useAuth();
  const location = useLocation();
  const groups = navGroups.map((group) => ({ ...group, items: visibleNavItems(group.items, isDirector) }));

  const displayName = profile?.full_name || user?.email || 'User';
  const role = profile?.role || 'Team Member';

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark">KTC</div>
        <div className="sidebar-brand-text">
          <strong>Kassam Trading Company</strong>
          <span>International Export CRM</span>
        </div>
      </div>

      <div className="sidebar-focus-card">
        <div className="sidebar-focus-icon"><Sparkles size={16} /></div>
        <div>
          <strong>Today’s focus</strong>
          <span>Follow up hot buyers and move orders forward.</span>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label="Main navigation">
        {groups.map((group) => (
          <div className={'sidebar-group' + (isGroupActive(group, location.pathname) ? ' group-active' : '')} key={group.label}>
            <div className="sidebar-group-label">{group.label}</div>
            {group.items.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')}
              >
                <Icon />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-user">
        <div className="sidebar-user-avatar">{initialsFrom(profile?.full_name, user?.email)}</div>
        <div className="sidebar-user-info" style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</strong>
          <span>{role}</span>
        </div>
        <button onClick={signOut} aria-label="Sign out" className="sidebar-logout" title="Sign out">
          <LogOut size={16} />
        </button>
      </div>
      <div className="sidebar-footer">KTC Order Workspace</div>
    </aside>
  );
}

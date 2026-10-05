import {
  LayoutDashboard,
  Users,
  ClipboardList,
  Settings,
  FolderOpen,
  CircleDollarSign,
  Mail,
  CheckSquare,
  Inbox,
  Sun,
  Boxes,
  Factory,
  BarChart3,
  Hourglass,
  ShieldCheck,
} from 'lucide-react';

export const navGroups = [
  {
    label: 'Workspace',
    items: [
      { to: '/today', label: 'Today', icon: Sun },
      { to: '/', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/approvals', label: 'Approvals', icon: ShieldCheck },
      { to: '/inquiries', label: 'Inquiries', icon: Inbox },
      { to: '/orders', label: 'Orders', icon: ClipboardList },
      { to: '/clients', label: 'Clients', icon: Users },
      { to: '/inventory', label: 'Inventory', icon: Boxes },
      { to: '/suppliers', label: 'Suppliers', icon: Factory },
      { to: '/documents', label: 'Documents', icon: FolderOpen },
      { to: '/payments', label: 'Payments', icon: CircleDollarSign },
      { to: '/outreach', label: 'Email Outreach', icon: Mail },
      { to: '/reengage', label: 'Re-engage', icon: Hourglass },
      { to: '/analytics', label: 'Analytics', icon: BarChart3 },
      { to: '/tasks', label: 'Tasks', icon: CheckSquare },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export const navItems = [
  { to: '/today', label: 'Today', icon: Sun },
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/approvals', label: 'Approvals', icon: ShieldCheck },
  { to: '/inquiries', label: 'Inquiries', icon: Inbox },
  { to: '/orders', label: 'Orders', icon: ClipboardList },
  { to: '/clients', label: 'Clients', icon: Users },
  { to: '/inventory', label: 'Inventory', icon: Boxes },
  { to: '/suppliers', label: 'Suppliers', icon: Factory },
  { to: '/documents', label: 'Documents', icon: FolderOpen },
  { to: '/payments', label: 'Payments', icon: CircleDollarSign },
  { to: '/outreach', label: 'Email Outreach', icon: Mail },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export const MOBILE_PRIMARY_COUNT = 4;

// Director (Dad mode) gets a short menu: what needs attention, orders, buyers.
const DIRECTOR_PATHS = ['/today', '/approvals', '/orders', '/inquiries', '/clients'];

export function visibleNavItems(items, isDirector) {
  if (!isDirector) return items;
  return DIRECTOR_PATHS.map((path) => items.find((item) => item.to === path)).filter(Boolean);
}

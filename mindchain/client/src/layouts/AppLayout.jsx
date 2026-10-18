import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../components/icons.jsx';
import { Badge, shortAddress } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useWallet } from '../context/WalletContext.jsx';
import { Logo } from './AuthLayout.jsx';

export const NAV = {
  patient: [
    { to: '/patient', label: 'Dashboard', icon: 'home', end: true },
    { to: '/patient/check-in', label: 'Daily check-in', icon: 'plus' },
    { to: '/patient/journal', label: 'Journal history', icon: 'book' },
    { to: '/patient/integrity', label: 'Record integrity', icon: 'shield' },
    { to: '/patient/consent', label: 'Therapist access', icon: 'key' },
    { to: '/patient/activity', label: 'Activity & transactions', icon: 'activity' },
    { to: '/wallet', label: 'Wallet', icon: 'wallet' },
  ],
  therapist: [
    { to: '/therapist', label: 'Dashboard', icon: 'home', end: true },
    { to: '/therapist/patients', label: 'My patients', icon: 'users' },
    { to: '/wallet', label: 'Wallet', icon: 'wallet' },
  ],
  admin: [
    { to: '/admin', label: 'Overview', icon: 'home', end: true },
    { to: '/admin/therapists', label: 'Therapist verification', icon: 'badge' },
    { to: '/admin/users', label: 'Users', icon: 'users' },
    { to: '/admin/audit', label: 'Audit log', icon: 'list' },
  ],
};

function SidebarContent({ items, onNavigate }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5">
        <Logo />
      </div>
      <nav className="flex-1 space-y-1 px-3 py-2" aria-label="Main">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`
            }
          >
            <Icon name={item.icon} />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-slate-200 p-4">
        <p className="truncate text-sm font-medium text-slate-900">{user?.name}</p>
        <p className="truncate text-xs text-slate-500 capitalize">{user?.role}</p>
        <button
          type="button"
          onClick={async () => {
            await logout();
            navigate('/login', { replace: true });
          }}
          className="mt-3 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
        >
          <Icon name="logout" className="h-4 w-4" /> Log out
        </button>
      </div>
    </div>
  );
}

function WalletPill() {
  const wallet = useWallet();
  const { user } = useAuth();
  if (user?.role === 'admin') return null;
  if (wallet.isLinkedAccount && wallet.onExpectedNetwork) {
    return (
      <NavLink to="/wallet">
        <Badge color="green">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" /> {shortAddress(wallet.account)}
        </Badge>
      </NavLink>
    );
  }
  const label = !wallet.hasProvider ? 'No MetaMask' : !wallet.linkedAddress ? 'Wallet not linked' : !wallet.account ? 'Wallet disconnected' : !wallet.isLinkedAccount ? 'Wrong account' : 'Wrong network';
  return (
    <NavLink to="/wallet">
      <Badge color="yellow">{label}</Badge>
    </NavLink>
  );
}

export default function AppLayout() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const items = NAV[user?.role] ?? [];

  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:fixed lg:inset-y-0 lg:block">
        <SidebarContent items={items} />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} aria-hidden="true" />
          <aside className="relative h-full w-72 max-w-[85%] bg-white shadow-xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute top-4 right-3 rounded-md p-1 text-slate-500 hover:bg-slate-100"
              aria-label="Close navigation"
            >
              <Icon name="close" />
            </button>
            <SidebarContent items={items} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button type="button" onClick={() => setOpen(true)} className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open navigation">
            <Icon name="menu" />
          </button>
          <span className="hidden text-sm text-slate-500 lg:block">
            Welcome back, <span className="font-medium text-slate-800">{user?.name?.split(' ')[0]}</span>
          </span>
          <WalletPill />
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
          <Outlet />
        </main>
        <footer className="px-6 pb-6 text-center text-xs text-slate-400">
          MindChain supports self-reflection and care coordination. It does not diagnose or replace professional mental healthcare.
        </footer>
      </div>
    </div>
  );
}

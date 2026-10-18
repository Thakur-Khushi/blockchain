import { Link } from 'react-router-dom';

export function Logo({ className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold text-slate-900 ${className}`}>
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#0f766e" />
        <path d="M9 20c0-5 3-9 7-9s7 4 7 9" fill="none" stroke="#ccfbf1" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="16" cy="21" r="2.5" fill="#ccfbf1" />
      </svg>
      MindChain
    </span>
  );
}

export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="flex min-h-screen">
      <aside className="relative hidden w-5/12 flex-col justify-between overflow-hidden bg-brand-800 p-10 text-brand-50 lg:flex">
        <Link to="/" className="text-white">
          <span className="inline-flex items-center gap-2 text-lg font-semibold">MindChain</span>
        </Link>
        <div className="relative z-10 max-w-md">
          <h2 className="text-3xl leading-tight font-semibold text-white">Your wellbeing, your data, your consent.</h2>
          <ul className="mt-6 space-y-3 text-sm text-brand-100">
            <li>• Daily mood and stress check-ins with private, encrypted journals</li>
            <li>• You decide which verified therapist can see your records — and can revoke it</li>
            <li>• Tamper-evident record fingerprints anchored on a blockchain</li>
          </ul>
        </div>
        <p className="relative z-10 text-xs text-brand-200">
          MindChain is a self-tracking tool. It does not diagnose conditions or replace professional care. If you are in
          crisis, contact your local emergency number.
        </p>
        <div className="absolute -right-24 -bottom-24 h-96 w-96 rounded-full bg-brand-700/60" aria-hidden="true" />
        <div className="absolute -top-16 -right-10 h-56 w-56 rounded-full bg-brand-600/40" aria-hidden="true" />
      </aside>
      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <Logo className="mb-8 lg:hidden" />
          <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-6 text-center text-sm text-slate-500">{footer}</div>}
        </div>
      </main>
    </div>
  );
}

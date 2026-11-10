import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useData, useRoute, usePref } from './store.jsx';
import { Modal } from './components/ui.jsx';
import { ExpenseForm, ActivityForm, PaycheckForm, SalaryForm } from './components/forms.jsx';
import * as Icons from './components/icons.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Expenses from './pages/Expenses.jsx';
import Activity from './pages/Activity.jsx';
import Balances from './pages/Balances.jsx';
import Income from './pages/Income.jsx';
import Budget from './pages/Budget.jsx';
import Metrics from './pages/Metrics.jsx';
import Projections from './pages/Projections.jsx';
import Settings from './pages/Settings.jsx';

export const PAGES = [
  { id: 'dashboard', label: 'Dashboard', icon: Icons.IconDashboard, component: Dashboard },
  { id: 'expenses', label: 'Expenses', icon: Icons.IconReceipt, component: Expenses },
  { id: 'activity', label: 'Account Activity', short: 'Activity', icon: Icons.IconSwap, component: Activity },
  { id: 'balances', label: 'Balances', icon: Icons.IconBank, component: Balances },
  { id: 'income', label: 'Income', icon: Icons.IconWallet, component: Income },
  { id: 'budget', label: 'Budget', icon: Icons.IconTarget, component: Budget },
  { id: 'metrics', label: 'Metrics', icon: Icons.IconChart, component: Metrics },
  { id: 'projections', label: 'Projections', icon: Icons.IconTrend, component: Projections },
  { id: 'settings', label: 'Settings', icon: Icons.IconSettings, component: Settings },
];

const MOBILE_TABS = ['dashboard', 'expenses', 'balances', 'budget'];

const FORMS = {
  expense: { title: (e) => (e ? 'Edit expense' : 'Add expense'), component: ExpenseForm },
  activity: { title: (e) => (e ? 'Edit account activity' : 'Add account activity'), component: ActivityForm },
  paycheck: { title: (e) => (e ? 'Edit paycheck' : 'Add paycheck'), component: PaycheckForm, wide: true },
  salary: { title: (e) => (e ? 'Edit salary entry' : 'Add salary entry'), component: SalaryForm },
};

const FormContext = createContext(() => {});
export const useForms = () => useContext(FormContext);

function ThemeToggle() {
  const [theme, setTheme] = usePref('theme', 'system');
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  const next = theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system';
  return (
    <button className="btn ghost sm" onClick={() => setTheme(next)} title={`Theme: ${theme} (click for ${next})`} style={{ width: '100%', justifyContent: 'flex-start' }}>
      {theme === 'dark' ? <Icons.IconMoon /> : <Icons.IconSun />}
      Theme: {theme}
    </button>
  );
}

export default function App() {
  const { data, error, reload } = useData();
  const { page, params } = useRoute();
  const [form, setForm] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const openForm = useCallback((kind, initial) => setForm({ kind, initial }), []);
  const closeForm = useCallback(() => setForm(null), []);

  const current = PAGES.find((p) => p.id === page) || PAGES[0];
  const Page = current.component;

  if (error && !data) {
    return (
      <div className="loading">
        <div className="empty">
          <h3>Can't reach the Mynance server</h3>
          <p>{error.message}</p>
          <button className="btn primary" onClick={reload}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!data) return <div className="loading">Loading…</div>;

  const F = form && FORMS[form.kind];

  return (
    <FormContext.Provider value={openForm}>
      <div className="app">
        <nav className="sidebar" aria-label="Main">
          <div className="brand">
            <span className="brand-mark">M</span> Mynance
          </div>
          {PAGES.map((p) => (
            <a key={p.id} href={`#/${p.id}`} className={`nav-link ${p.id === current.id ? 'active' : ''}`} aria-current={p.id === current.id ? 'page' : undefined}>
              <p.icon /> {p.label}
            </a>
          ))}
          <div className="sidebar-foot">
            <ThemeToggle />
          </div>
        </nav>

        <div className="main">
          <header className="topbar">
            <span className="brand-mark mobile-brand">M</span>
            <h1>{current.label}</h1>
            <button className="btn primary hide-mobile" onClick={() => openForm('expense')}>
              <Icons.IconPlus /> Expense
            </button>
          </header>
          <main className="content">
            <Page params={params} />
          </main>
        </div>

        <button className="fab" onClick={() => openForm('expense')} aria-label="Add expense">
          <Icons.IconPlus />
        </button>
        <nav className="bottom-nav" aria-label="Main">
          {MOBILE_TABS.map((id) => {
            const p = PAGES.find((x) => x.id === id);
            return (
              <a key={id} href={`#/${id}`} className={id === current.id ? 'active' : ''}>
                <p.icon />
                {p.short || p.label}
              </a>
            );
          })}
          <button onClick={() => setMoreOpen(true)} className={!MOBILE_TABS.includes(current.id) ? 'active' : ''} style={!MOBILE_TABS.includes(current.id) ? { color: 'var(--accent-ink)' } : undefined}>
            <Icons.IconMore />
            More
          </button>
        </nav>

        {moreOpen && (
          <Modal title="Go to" onClose={() => setMoreOpen(false)}>
            <div className="sheet-links">
              {PAGES.map((p) => (
                <a key={p.id} href={`#/${p.id}`} onClick={() => setMoreOpen(false)}>
                  <p.icon />
                  {p.short || p.label}
                </a>
              ))}
            </div>
            <div style={{ marginTop: 16 }}>
              <ThemeToggle />
            </div>
          </Modal>
        )}

        {F && (
          <Modal title={F.title(form.initial?.id)} onClose={closeForm} wide={F.wide}>
            <F.component initial={form.initial} onDone={closeForm} />
          </Modal>
        )}
      </div>
    </FormContext.Provider>
  );
}

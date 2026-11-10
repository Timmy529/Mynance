import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { setLocale } from './lib/format.js';
import { todayISO } from './lib/dates.js';

const DataContext = createContext(null);
const ToastContext = createContext(() => {});

function sortByDate(list) {
  return list
    .map((r, i) => [r, i])
    .sort((a, b) => (a[0].date < b[0].date ? -1 : a[0].date > b[0].date ? 1 : a[1] - b[1]))
    .map(([r]) => r);
}

export function DataProvider({ children }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [today, setToday] = useState(todayISO());
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const next = await api.get('/api/data');
      setLocale(next.config.settings);
      setData(next);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      loading.current = false;
    }
  }, []);

  useEffect(() => {
    load();
    // Pick up edits made directly to the data files, and roll "today" over at midnight.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        setToday(todayISO());
        load();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const actions = useMemo(() => {
    const patchRecords = (collection, fn) =>
      setData((d) => ({ ...d, records: { ...d.records, [collection]: fn(d.records[collection]) } }));
    return {
      reload: load,
      async create(collection, rec) {
        const saved = await api.post(`/api/records/${collection}`, rec);
        patchRecords(collection, (list) => sortByDate([...list, saved]));
        return saved;
      },
      async update(collection, id, rec) {
        const saved = await api.put(`/api/records/${collection}/${id}`, rec);
        patchRecords(collection, (list) => sortByDate(list.map((r) => (r.id === id ? saved : r))));
        return saved;
      },
      async remove(collection, id) {
        await api.del(`/api/records/${collection}/${id}`);
        patchRecords(collection, (list) => list.filter((r) => r.id !== id));
      },
      async saveBalances(records) {
        const res = await api.post('/api/records/balances/batch', { records });
        const byId = new Map(res.records.map((r) => [r.id, r]));
        patchRecords('balances', (list) => {
          const kept = list.filter((r) => !byId.has(r.id));
          return sortByDate([...kept, ...res.records]);
        });
        return res.records;
      },
      async saveConfig(name, value) {
        const saved = await api.put(`/api/config/${name}`, value);
        if (name === 'settings') setLocale(saved);
        setData((d) => ({ ...d, config: { ...d.config, [name]: saved } }));
        return saved;
      },
      async rename(body) {
        const res = await api.post('/api/rename', body);
        setData((d) => ({ ...d, config: res.config, records: res.records }));
        return res;
      },
    };
  }, [load]);

  const value = useMemo(() => ({ data, error, today, ...actions }), [data, error, today, actions]);
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  return useContext(DataContext);
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const toast = useCallback((message, kind = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 5000 : 2500);
  }, []);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// ---- tiny hash router ----
function parseHash() {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = h.split('?');
  return { page: path || 'dashboard', params: Object.fromEntries(new URLSearchParams(query)) };
}

export function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(page, params) {
  const q = params ? `?${new URLSearchParams(params)}` : '';
  window.location.hash = `/${page}${q}`;
}

// localStorage helpers (per-browser conveniences only; never data of record)
export function usePref(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(`mynance:${key}`);
      return raw === null ? initial : JSON.parse(raw);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v) => {
      setValue((prev) => {
        const next = typeof v === 'function' ? v(prev) : v;
        try {
          localStorage.setItem(`mynance:${key}`, JSON.stringify(next));
        } catch {
          /* storage unavailable */
        }
        return next;
      });
    },
    [key],
  );
  return [value, set];
}

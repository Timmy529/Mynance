import { Children, cloneElement, isValidElement, useEffect, useId, useRef, useState, createContext, useContext, useCallback } from 'react';
import { IconClose } from './icons.jsx';

export function Card({ title, subtitle, actions, children, className = '', flush = false, ...rest }) {
  return (
    <section className={`card ${flush ? 'flush' : ''} ${className}`} {...rest}>
      {(title || actions) && (
        <div className="card-head">
          <div className="titles">
            {title && <h2>{title}</h2>}
            {subtitle && <div className="subtitle">{subtitle}</div>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, delta, deltaGood = true, onClick, title }) {
  const dir = delta === undefined || delta === null ? null : delta >= 0 ? 'up' : 'down';
  const good = dir === null ? null : (dir === 'up') === deltaGood;
  return (
    <div className={`stat ${onClick ? 'clickable' : ''}`} onClick={onClick} title={title} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {(sub || dir) && (
        <div className="stat-sub">
          {dir && <span className={`delta ${good ? 'up' : 'down'}`}>{dir === 'up' ? '▲' : '▼'} </span>}
          {sub}
        </div>
      )}
    </div>
  );
}

// Labels are tied to the first child control (an id is added if it has none),
// so tapping the label focuses the input and screen readers announce it.
export function Field({ label, hint, error, children, className = '' }) {
  const autoId = useId();
  const kids = Children.toArray(children);
  let id;
  if (kids.length && isValidElement(kids[0])) {
    id = kids[0].props.id || autoId;
    if (!kids[0].props.id) kids[0] = cloneElement(kids[0], { id });
  }
  return (
    <div className={`field ${className}`}>
      {label && <label htmlFor={id}>{label}</label>}
      {kids}
      {hint && !error && <div className="hint">{hint}</div>}
      {error && <div className="error">{error}</div>}
    </div>
  );
}

// Text input that keeps what the user typed, and reports a number (or '' when blank).
const moneyText = (v) => (v === null || v === undefined || v === '' ? '' : String(v));
function parseMoneyText(t) {
  const cleaned = String(t).replace(/[$,\s]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return '';
  const n = Number(cleaned);
  return Number.isNaN(n) ? '' : n;
}

export function MoneyInput({ value, onChange, big = false, placeholder = '0.00', allowNegative = false, ...rest }) {
  const [text, setText] = useState(moneyText(value));
  // Re-sync only when the parent sets a value that differs from what was typed.
  useEffect(() => {
    setText((t) => (parseMoneyText(t) === (value ?? '') ? t : moneyText(value)));
  }, [value]);
  return (
    <div className={`input-prefix ${big ? 'big' : ''}`}>
      <span>$</span>
      <input
        className={`input ${big ? 'big' : ''} tabular`}
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          let t = e.target.value;
          if (!allowNegative) t = t.replace(/-/g, '');
          setText(t);
          onChange(parseMoneyText(t));
        }}
        {...rest}
      />
    </div>
  );
}

export function PercentInput({ value, onChange, placeholder, ...rest }) {
  return (
    <div className="input-suffix">
      <input
        className="input tabular"
        inputMode="decimal"
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === '' ? '' : e.target.value)}
        {...rest}
      />
      <span>%</span>
    </div>
  );
}

export function Select({ value, onChange, options, placeholder, className = '', small = false, ...rest }) {
  return (
    <select className={`select ${small ? 'sm' : ''} ${className}`} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) =>
        o.group ? (
          <optgroup key={o.group} label={o.group}>
            {o.options.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </optgroup>
        ) : (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ),
      )}
    </select>
  );
}

export function Segmented({ value, onChange, options, label }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs({ value, onChange, options }) {
  return (
    <div className="tabs" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, wide = false, actions }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const first = ref.current?.querySelector('[autofocus], input:not([type=hidden]), select, textarea');
    if (first && window.matchMedia('(pointer: fine)').matches) first.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          {actions}
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const confirm = useCallback(
    (opts) =>
      new Promise((resolve) => {
        setState({ ...opts, resolve });
      }),
    [],
  );
  const close = (v) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <Modal title={state.title || 'Are you sure?'} onClose={() => close(false)}>
          <div className="form">
            {state.message && <p className="ink-2">{state.message}</p>}
            <div className="form-actions">
              <button className={`btn ${state.danger ? 'primary' : 'primary'}`} style={state.danger ? { background: 'var(--bad)', borderColor: 'var(--bad)' } : undefined} onClick={() => close(true)} autoFocus>
                {state.confirmLabel || 'Confirm'}
              </button>
              <button className="btn" onClick={() => close(false)}>
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}

export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      {title && <h3>{title}</h3>}
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Meter({ value, max, pace, label }) {
  const pct = max > 0 ? Math.min(1, value / max) : value > 0 ? 1 : 0;
  const over = max > 0 ? value / max : 0;
  const tone = over > 1 ? 'bad' : pace !== undefined && pace !== null && max > 0 && value > pace * 1.1 ? 'warn' : '';
  return (
    <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <div className={`fill ${tone}`} style={{ width: `${pct * 100}%` }} />
      {pace !== undefined && pace !== null && max > 0 && pace < max && <div className="pace" style={{ left: `calc(${(pace / max) * 100}% - 1px)` }} title="Expected by today" />}
    </div>
  );
}

export function useSaving() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(async (fn) => {
    setSaving(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err.message || String(err));
      throw err;
    } finally {
      setSaving(false);
    }
  }, []);
  return { saving, error, setError, run };
}

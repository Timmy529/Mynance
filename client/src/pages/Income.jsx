import { useMemo } from 'react';
import { useData, usePref } from '../store.jsx';
import { useForms } from '../App.jsx';
import { Card, Stat, Tabs, Segmented, Empty } from '../components/ui.jsx';
import { ChartCard, BarsChart, TimeChart } from '../components/charts.jsx';
import { IconPlus, IconDownload } from '../components/icons.jsx';
import { paycheckTotals, salaryHistory, salaryTimeline, currentSalary, otherIncome } from '../lib/spending.js';
import { money, dollars, pct, signedPct } from '../lib/format.js';
import { formatDate } from '../lib/dates.js';

function Paychecks() {
  const { data, today } = useData();
  const openForm = useForms();
  const years = useMemo(() => {
    const ys = [...new Set(data.records.paychecks.map((p) => p.date.slice(0, 4)))];
    if (!ys.includes(today.slice(0, 4))) ys.push(today.slice(0, 4));
    return ys.sort().reverse().slice(0, 6);
  }, [data.records.paychecks, today]);
  const [year, setYear] = usePref('income.year', today.slice(0, 4));
  const y = years.includes(year) ? year : years[0];

  const list = useMemo(
    () => data.records.paychecks.filter((p) => p.date.startsWith(y)).map((p) => ({ ...p, t: paycheckTotals(p) })),
    [data.records.paychecks, y],
  );
  const sum = list.reduce(
    (s, p) => ({ gross: s.gross + p.t.gross, taxes: s.taxes + p.t.taxes, retirement: s.retirement + p.t.retirement, benefits: s.benefits + p.t.benefits, net: s.net + p.t.net, bonus: s.bonus + (p.bonus || 0), match: s.match + p.t.match }),
    { gross: 0, taxes: 0, retirement: 0, benefits: 0, net: 0, bonus: 0, match: 0 },
  );
  const other = otherIncome(data.records.activity, data.config.categories).filter((a) => a.date.startsWith(y));
  const otherTotal = other.reduce((s, a) => s + a.amount, 0);

  const chart = list.map((p) => ({ date: p.date, net: p.t.net, taxes: p.t.taxes, retirement: p.t.retirement, benefits: p.t.benefits }));

  return (
    <div className="stack">
      <div className="filter-bar">
        <Segmented value={y} onChange={setYear} options={years.map((v) => ({ value: v, label: v }))} label="Year" />
        <span className="spacer" />
        <a className="btn sm ghost" href="/api/export/paychecks.csv" download>
          <IconDownload /> CSV
        </a>
        <button className="btn primary sm" onClick={() => openForm('paycheck')}>
          <IconPlus /> Add paycheck
        </button>
      </div>
      <div className="tiles">
        <Stat label="Gross pay" value={dollars(sum.gross)} sub={sum.bonus ? `incl. ${dollars(sum.bonus)} bonus` : `${list.length} paycheck${list.length === 1 ? '' : 's'}`} />
        <Stat label="Taxes" value={dollars(sum.taxes)} sub={sum.gross ? `${pct(sum.taxes / sum.gross)} of gross` : ''} />
        <Stat label="Retirement saved" value={dollars(sum.retirement)} sub={sum.match ? `+ ${dollars(sum.match)} employer match` : sum.gross ? `${pct(sum.retirement / sum.gross)} of gross` : ''} />
        <Stat label="Benefits" value={dollars(sum.benefits)} sub="Medical, dental, vision, other" />
        <Stat label="Take-home pay" value={dollars(sum.net)} sub={sum.gross ? `${pct(sum.net / sum.gross)} of gross` : ''} />
        <Stat label="Other income" value={dollars(otherTotal)} sub={`${other.length} entr${other.length === 1 ? 'y' : 'ies'} from account activity`} />
      </div>

      <ChartCard
        title="Where each paycheck goes"
        subtitle={`${y} · gross pay split into take-home, taxes, retirement and benefits`}
        legend={[
          { label: 'Take-home', color: 'var(--s1)' },
          { label: 'Taxes', color: 'var(--s2)' },
          { label: 'Retirement', color: 'var(--s3)' },
          { label: 'Benefits', color: 'var(--s4)' },
        ]}
      >
        {chart.length ? (
          <BarsChart
            data={chart}
            xKey="date"
            stacked
            xFormat={(d) => formatDate(d, { year: false })}
            labelFormat={(d) => formatDate(d)}
            series={[
              { key: 'net', label: 'Take-home', color: 'var(--s1)' },
              { key: 'taxes', label: 'Taxes', color: 'var(--s2)' },
              { key: 'retirement', label: 'Retirement', color: 'var(--s3)' },
              { key: 'benefits', label: 'Benefits', color: 'var(--s4)' },
            ]}
          />
        ) : (
          <Empty title={`No paychecks in ${y}`} action={<button className="btn primary" onClick={() => openForm('paycheck')}>Add paycheck</button>}>
            Each new paycheck is pre-filled from the previous one.
          </Empty>
        )}
      </ChartCard>

      {list.length > 0 && (
        <Card flush>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="hide-mobile">Employer</th>
                  <th className="num">Gross</th>
                  <th className="num hide-mobile">Taxes</th>
                  <th className="num hide-mobile">Retirement</th>
                  <th className="num hide-mobile">Benefits</th>
                  <th className="num">Net</th>
                </tr>
              </thead>
              <tbody>
                {list
                  .slice()
                  .reverse()
                  .map((p) => (
                    <tr key={p.id} className="clickable" onClick={() => openForm('paycheck', p)}>
                      <td>
                        {formatDate(p.date)}
                        {p.bonus ? <span className="badge accent" style={{ marginLeft: 6 }}>bonus</span> : null}
                      </td>
                      <td className="hide-mobile">{p.employer}</td>
                      <td className="num">{money(p.t.gross)}</td>
                      <td className="num hide-mobile">{money(p.t.taxes)}</td>
                      <td className="num hide-mobile">{money(p.t.retirement)}</td>
                      <td className="num hide-mobile">{money(p.t.benefits)}</td>
                      <td className="num">
                        {money(p.t.net)}
                        {Math.abs(p.t.difference) >= 0.01 && (
                          <div className="cell-sub warn" title="Net pay differs from gross minus deductions">
                            {money(p.t.difference)} unexplained
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="hide-mobile" />
                  <td className="num">{money(sum.gross)}</td>
                  <td className="num hide-mobile">{money(sum.taxes)}</td>
                  <td className="num hide-mobile">{money(sum.retirement)}</td>
                  <td className="num hide-mobile">{money(sum.benefits)}</td>
                  <td className="num">{money(sum.net)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Salary() {
  const { data, today } = useData();
  const openForm = useForms();
  const history = useMemo(() => salaryHistory(data.records.salary), [data.records.salary]);
  const timeline = useMemo(() => salaryTimeline(data.records.salary, today), [data.records.salary, today]);
  const current = currentSalary(data.records.salary, today);
  const raises = history.filter((h) => h.change !== null);
  const lastRaise = raises[raises.length - 1];
  const first = timeline.find((p) => p.total > 0);
  const years = first ? (new Date(today) - new Date(first.date)) / (365.25 * 86400000) : 0;
  const cagr = first && years >= 1 && current.total > 0 ? (current.total / first.total) ** (1 / years) - 1 : null;

  return (
    <div className="stack">
      <div className="filter-bar">
        <span className="small ink-2">Record each salary change (raises, promotions, new jobs). Enter 0 to mark a job as ended.</span>
        <span className="spacer" />
        <button className="btn primary sm" onClick={() => openForm('salary')}>
          <IconPlus /> Add salary change
        </button>
      </div>
      <div className="tiles">
        <Stat label="Current salary" value={dollars(current.total)} sub={current.records.map((r) => r.employer || 'Salary').join(' + ') || 'No salary recorded'} />
        <Stat label="Last raise" value={lastRaise ? signedPct(lastRaise.change) : '—'} sub={lastRaise ? `${formatDate(lastRaise.date)} · ${lastRaise.employer || ''}` : 'Add two entries to see raises'} />
        <Stat label="Average raise" value={raises.length ? signedPct(raises.reduce((s, r) => s + r.change, 0) / raises.length) : '—'} sub={`${raises.length} change${raises.length === 1 ? '' : 's'}`} />
        <Stat label="Annual growth" value={cagr !== null ? signedPct(cagr) : '—'} sub={first ? `since ${formatDate(first.date)}` : ''} />
      </div>
      <ChartCard title="Salary over time" subtitle="Total annual base salary across employers">
        {timeline.length ? (
          <TimeChart data={timeline} xKey="date" xFormat={(d) => formatDate(d)} series={[{ key: 'total', label: 'Salary', color: 'var(--s1)', step: true }]} />
        ) : (
          <Empty title="No salary history yet" action={<button className="btn primary" onClick={() => openForm('salary')}>Add salary</button>} />
        )}
      </ChartCard>
      {history.length > 0 && (
        <Card flush>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Effective</th>
                  <th>Employer</th>
                  <th className="hide-mobile">Title</th>
                  <th className="num">Salary</th>
                  <th className="num">Change</th>
                  <th className="hide-mobile">Notes</th>
                </tr>
              </thead>
              <tbody>
                {history
                  .slice()
                  .reverse()
                  .map((s) => (
                    <tr key={s.id} className="clickable" onClick={() => openForm('salary', s)}>
                      <td>{formatDate(s.date)}</td>
                      <td>{s.employer}</td>
                      <td className="hide-mobile">{s.title}</td>
                      <td className="num">{s.salary ? dollars(s.salary) : <span className="badge">ended</span>}</td>
                      <td className={`num ${s.change > 0 ? 'good' : s.change < 0 ? 'bad' : ''}`}>{s.change === null ? '' : signedPct(s.change)}</td>
                      <td className="hide-mobile muted">{s.notes}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

export default function Income() {
  const [tab, setTab] = usePref('income.tab', 'paychecks');
  return (
    <div>
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'paychecks', label: 'Paychecks' },
          { value: 'salary', label: 'Salary & raises' },
        ]}
      />
      {tab === 'salary' ? <Salary /> : <Paychecks />}
    </div>
  );
}

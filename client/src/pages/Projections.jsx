import { useEffect, useMemo, useState } from 'react';
import { useData, useToast } from '../store.jsx';
import { Card, Stat, Field, MoneyInput, PercentInput, Segmented, useSaving } from '../components/ui.jsx';
import { ChartCard, TimeChart } from '../components/charts.jsx';
import { computeCore, projectionInputs, netWorthProjection, windowFor, ledger } from '../lib/metrics.js';
import { projectInvestments, retirementPlan } from '../lib/projections.js';
import { averages } from '../lib/spending.js';
import { dollars, pct, signedDollars } from '../lib/format.js';
import { monthLabel, monthLabelLong } from '../lib/dates.js';

const numOr = (v, d) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? d : Number(v));

function Assumptions({ draft, setDraft, auto, dirty, onSave, saving }) {
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  return (
    <Card title="Assumptions" subtitle="Used by the dashboard roadmap, end-of-year estimate and the projections below">
      <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
        <Field label="Investment return / yr">
          <PercentInput value={draft.expectedReturn} onChange={(v) => set('expectedReturn', v)} />
        </Field>
        <Field label="Home appreciation / yr">
          <PercentInput value={draft.homeAppreciation} onChange={(v) => set('homeAppreciation', v)} />
        </Field>
        <Field label="Cash return / yr">
          <PercentInput value={draft.cashReturn} onChange={(v) => set('cashReturn', v)} />
        </Field>
        <Field label="Inflation / yr">
          <PercentInput value={draft.inflation} onChange={(v) => set('inflation', v)} />
        </Field>
        <Field label="Invested per month" hint={`Blank = auto (${dollars(auto.autoInvestment)}, from ${auto.autoSource === 'contributions' ? 'recorded contributions' : auto.autoSource === 'savings' ? 'income − spending' : 'no data'})`}>
          <MoneyInput value={draft.monthlyInvestment ?? ''} onChange={(v) => set('monthlyInvestment', v === '' ? null : v)} placeholder={String(Math.round(auto.autoInvestment))} />
        </Field>
        <Field label="Added to cash per month">
          <MoneyInput value={draft.monthlyCash ?? ''} onChange={(v) => set('monthlyCash', v === '' ? null : v)} placeholder="0" allowNegative />
        </Field>
        <Field label="Years to project">
          <input className="input" type="number" min="1" max="60" value={draft.years} onChange={(e) => set('years', e.target.value)} />
        </Field>
      </div>
      <div className="form-actions" style={{ marginTop: 14 }}>
        <button className="btn primary" disabled={!dirty || saving} onClick={onSave}>
          {saving ? 'Saving…' : 'Save assumptions'}
        </button>
        {dirty && <span className="small muted">Charts below already show your changes.</span>}
        {auto.mortgagePaydown > 0 && <span className="small muted">Mortgage paydown: {dollars(auto.mortgagePaydown)}/mo (from recorded balances).</span>}
      </div>
    </Card>
  );
}

function Retirement({ core, inputs }) {
  const { data, today, saveConfig } = useData();
  const toast = useToast();
  const { saving, run } = useSaving();
  const r = data.config.settings.retirement;
  const [d, setD] = useState(r);
  const [view, setView] = useState('real');
  useEffect(() => setD(r), [r]);
  const set = (k, v) => setD((x) => ({ ...x, [k]: v }));
  const dirty = JSON.stringify(d) !== JSON.stringify(r);

  const year = Number(today.slice(0, 4));
  const spendAvg = useMemo(() => {
    const w = windowFor(12, today);
    return averages(ledger(data), w.start, w.end).spending.monthlyAll;
  }, [data, today]);
  const autoSpending = spendAvg ? Math.round(spendAvg * 12) : 0;
  const t = core.current.totals;
  const birthYear = numOr(d.birthYear, null);
  const currentAge = birthYear ? year - birthYear : null;

  const plan = useMemo(() => {
    if (currentAge === null) return null;
    return retirementPlan({
      currentAge,
      retirementAge: numOr(d.retirementAge, 60),
      endAge: numOr(d.endAge, 95),
      startBalance: t.investments + (d.includeCash ? t.cash : 0),
      annualContribution: (inputs.monthlyInvestment + (d.includeCash ? inputs.monthlyCash : 0)) * 12,
      annualSpending: numOr(d.annualSpending, autoSpending),
      returnBefore: numOr(d.returnBeforeRetirement, 7),
      returnAfter: numOr(d.returnInRetirement, 5),
      inflation: numOr(d.inflation, 3),
      otherIncome: numOr(d.otherIncome, 0),
      otherIncomeStartAge: numOr(d.otherIncomeStartAge, 67),
      withdrawalRate: numOr(d.withdrawalRate, 4),
      startYear: year,
    });
  }, [currentAge, d, t, inputs, autoSpending, year]);

  const save = async () => {
    const clean = { ...d };
    for (const k of ['birthYear', 'retirementAge', 'endAge', 'annualSpending', 'returnBeforeRetirement', 'returnInRetirement', 'inflation', 'otherIncome', 'otherIncomeStartAge', 'withdrawalRate']) {
      clean[k] = d[k] === '' || d[k] === null ? (k === 'birthYear' || k === 'annualSpending' ? null : r[k]) : Number(d[k]);
    }
    const ok = await run(() => saveConfig('settings', { ...data.config.settings, retirement: clean })).catch(() => false);
    if (ok) toast('Retirement plan saved');
  };

  const retAge = numOr(d.retirementAge, 60);
  const chart = plan?.rows.map((row) => ({ age: row.age, balance: view === 'real' ? row.real : row.balance })) || [];

  return (
    <div className="stack">
      <Card title="Retirement burn-down" subtitle="Grows your investments until retirement, then withdraws your spending each year (rising with inflation, minus other income like Social Security)">
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
          <Field label="Birth year">
            <input className="input" type="number" value={d.birthYear ?? ''} onChange={(e) => set('birthYear', e.target.value)} placeholder="e.g. 1988" />
          </Field>
          <Field label="Retire at age">
            <input className="input" type="number" value={d.retirementAge ?? ''} onChange={(e) => set('retirementAge', e.target.value)} />
          </Field>
          <Field label="Plan through age">
            <input className="input" type="number" value={d.endAge ?? ''} onChange={(e) => set('endAge', e.target.value)} />
          </Field>
          <Field label="Spending / yr (today's $)" hint={`Blank = last 12 months (${dollars(autoSpending)})`}>
            <MoneyInput value={d.annualSpending ?? ''} onChange={(v) => set('annualSpending', v === '' ? null : v)} placeholder={String(autoSpending)} />
          </Field>
          <Field label="Return before retiring">
            <PercentInput value={d.returnBeforeRetirement ?? ''} onChange={(v) => set('returnBeforeRetirement', v)} />
          </Field>
          <Field label="Return in retirement">
            <PercentInput value={d.returnInRetirement ?? ''} onChange={(v) => set('returnInRetirement', v)} />
          </Field>
          <Field label="Inflation">
            <PercentInput value={d.inflation ?? ''} onChange={(v) => set('inflation', v)} />
          </Field>
          <Field label="Other income / yr (today's $)" hint="Social Security, pension…">
            <MoneyInput value={d.otherIncome ?? ''} onChange={(v) => set('otherIncome', v)} />
          </Field>
          <Field label="Other income starts at age">
            <input className="input" type="number" value={d.otherIncomeStartAge ?? ''} onChange={(e) => set('otherIncomeStartAge', e.target.value)} />
          </Field>
          <Field label="Safe withdrawal rate">
            <PercentInput value={d.withdrawalRate ?? ''} onChange={(v) => set('withdrawalRate', v)} />
          </Field>
          <Field label="Include cash">
            <label className="check" style={{ height: 40 }}>
              <input type="checkbox" checked={!!d.includeCash} onChange={(e) => set('includeCash', e.target.checked)} /> Count cash savings too
            </label>
          </Field>
        </div>
        <div className="form-actions" style={{ marginTop: 14 }}>
          <button className="btn primary" disabled={!dirty || saving} onClick={save}>
            Save plan
          </button>
          <span className="small muted">
            Starting from {dollars(t.investments + (d.includeCash ? t.cash : 0))} and adding {dollars((inputs.monthlyInvestment + (d.includeCash ? inputs.monthlyCash : 0)) * 12)}/yr until retirement.
          </span>
        </div>
      </Card>

      {!plan ? (
        <Card>
          <p className="ink-2">Enter your birth year to see the retirement burn-down.</p>
        </Card>
      ) : (
        <>
          <div className="tiles">
            <Stat label={`Portfolio at ${retAge}`} value={dollars(plan.atRetirementReal)} sub={`${dollars(plan.atRetirement)} in future dollars`} />
            <Stat
              label="Money lasts"
              value={plan.depletionAge === null ? `Past ${numOr(d.endAge, 95)}` : `Until ${plan.depletionAge}`}
              sub={plan.depletionAge === null ? 'Funds remain through the plan' : `${plan.depletionAge - retAge} years of retirement`}
              delta={plan.depletionAge === null ? 1 : -1}
            />
            <Stat label={`${numOr(d.withdrawalRate, 4)}% rule income`} value={`${dollars(plan.sustainableSpending)}/yr`} sub="today's dollars, incl. other income" />
            <Stat label="Max spending to last" value={`${dollars(plan.maxSpending)}/yr`} sub={`through age ${numOr(d.endAge, 95)}, today's dollars`} />
            <Stat label="Nest egg needed" value={dollars(plan.neededAtRetirement)} sub={`for ${dollars(numOr(d.annualSpending, autoSpending))}/yr at ${numOr(d.withdrawalRate, 4)}%`} />
          </div>
          <ChartCard
            title="Portfolio by age"
            subtitle={plan.depletionAge ? `Runs out at ${plan.depletionAge}` : 'Balance at the start of each year'}
            actions={<Segmented value={view} onChange={setView} options={[{ value: 'real', label: "Today's $" }, { value: 'nominal', label: 'Future $' }]} label="Dollars" />}
            table={{
              columns: [
                { key: 'age', label: 'Age' },
                { key: 'year', label: 'Year' },
                { key: 'balance', label: 'Balance', num: true, format: dollars },
                { key: 'real', label: "Today's $", num: true, format: dollars },
                { key: 'contribution', label: 'Added', num: true, format: (v) => (v ? dollars(v) : '') },
                { key: 'withdrawal', label: 'Withdrawn', num: true, format: (v) => (v ? dollars(v) : '') },
              ],
              rows: plan.rows,
            }}
          >
            <TimeChart
              data={chart}
              xKey="age"
              labelFormat={(a) => `Age ${a}`}
              referenceX={retAge}
              referenceLabel="Retire"
              series={[{ key: 'balance', label: 'Portfolio', color: 'var(--s1)', area: true }]}
              height={300}
            />
          </ChartCard>
        </>
      )}
    </div>
  );
}

export default function Projections() {
  const { data, today, saveConfig } = useData();
  const toast = useToast();
  const { saving, run } = useSaving();
  const settings = data.config.settings;
  const core = useMemo(() => computeCore(data, today), [data, today]);
  const auto = useMemo(() => projectionInputs(data, core, today), [data, core, today]);
  const [draft, setDraft] = useState(settings.projection);
  useEffect(() => setDraft(settings.projection), [settings.projection]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings.projection);

  const inputs = useMemo(
    () => ({
      ...auto,
      expectedReturn: numOr(draft.expectedReturn, 7),
      homeAppreciation: numOr(draft.homeAppreciation, 3),
      cashReturn: numOr(draft.cashReturn, 0),
      inflation: numOr(draft.inflation, 3),
      monthlyInvestment: numOr(draft.monthlyInvestment, auto.autoInvestment),
      monthlyCash: numOr(draft.monthlyCash, 0),
    }),
    [auto, draft],
  );
  const years = Math.min(60, Math.max(1, numOr(draft.years, 10)));

  const nw = useMemo(() => {
    const past = core.series.map((s) => ({ month: s.month, actual: s.netWorth }));
    const future = netWorthProjection(core, inputs, years * 12).map((p) => ({ month: p.month, projected: p.netWorth, investments: p.investments }));
    if (past.length) {
      past[past.length - 1].projected = past[past.length - 1].actual;
      past[past.length - 1].investments = core.current.totals.investments;
    }
    return { rows: [...past, ...future], future };
  }, [core, inputs, years]);

  const t = core.current.totals;
  const decIdx = nw.future.findIndex((p) => p.month.endsWith('-12'));
  const eoy = decIdx >= 0 ? nw.future[decIdx].projected : t.netWorth;
  const at = (n) => nw.future[Math.min(nw.future.length - 1, n * 12 - 1)]?.projected;
  const milestone = [250000, 500000, 1000000, 2000000, 5000000].find((m) => m > t.netWorth);
  const hit = milestone ? nw.future.find((p) => p.projected >= milestone) : null;

  const inv = useMemo(
    () => projectInvestments({ value: t.investments, contributed: t.contributed || 0, years, rate: inputs.expectedReturn, monthlyContribution: inputs.monthlyInvestment, startYear: Number(today.slice(0, 4)) }),
    [t.investments, t.contributed, years, inputs.expectedReturn, inputs.monthlyInvestment, today],
  );
  const invEnd = inv.rows[inv.rows.length - 1];

  const save = async () => {
    const clean = {
      ...draft,
      years: years,
      expectedReturn: inputs.expectedReturn,
      homeAppreciation: inputs.homeAppreciation,
      cashReturn: inputs.cashReturn,
      inflation: inputs.inflation,
      monthlyInvestment: draft.monthlyInvestment === '' || draft.monthlyInvestment === null ? null : Number(draft.monthlyInvestment),
      monthlyCash: draft.monthlyCash === '' || draft.monthlyCash === null ? null : Number(draft.monthlyCash),
    };
    const ok = await run(() => saveConfig('settings', { ...settings, projection: clean })).catch(() => false);
    if (ok) toast('Assumptions saved');
  };

  return (
    <div className="stack">
      <Assumptions draft={draft} setDraft={setDraft} auto={auto} dirty={dirty} onSave={save} saving={saving} />

      <div className="tiles">
        <Stat label="Net worth today" value={dollars(t.netWorth)} />
        <Stat label={`Dec 31 ${today.slice(0, 4)}`} value={dollars(eoy)} sub={signedDollars(eoy - t.netWorth)} />
        <Stat label="In 5 years" value={dollars(at(5))} />
        <Stat label={`In ${years} years`} value={dollars(at(years))} sub={`${dollars((at(years) || 0) / (1 + inputs.inflation / 100) ** years)} in today's dollars`} />
        {milestone && <Stat label={`Reach ${dollars(milestone)}`} value={hit ? monthLabelLong(hit.month) : `Beyond ${years} yrs`} />}
      </div>

      <ChartCard
        title="Net worth projection"
        subtitle={`${inputs.expectedReturn}% investment return, ${inputs.homeAppreciation}% home appreciation, ${dollars(inputs.monthlyInvestment)}/mo invested`}
        legend={[
          { label: 'Actual net worth', color: 'var(--s1)', type: 'line' },
          { label: 'Projected net worth', color: 'var(--s1)', type: 'dashed' },
          { label: 'Projected investments', color: 'var(--s2)', type: 'dashed' },
        ]}
        table={{
          columns: [
            { key: 'month', label: 'Month', format: monthLabelLong },
            { key: 'actual', label: 'Actual', num: true, format: (v) => (v === undefined ? '' : dollars(v)) },
            { key: 'projected', label: 'Projected', num: true, format: (v) => (v === undefined ? '' : dollars(v)) },
            { key: 'investments', label: 'Investments', num: true, format: (v) => (v === undefined ? '' : dollars(v)) },
          ],
          rows: nw.rows,
        }}
      >
        <TimeChart
          data={nw.rows}
          xKey="month"
          xFormat={(k) => monthLabel(k)}
          labelFormat={monthLabelLong}
          referenceX={core.endKey}
          referenceLabel="Today"
          height={320}
          series={[
            { key: 'actual', label: 'Actual', color: 'var(--s1)', area: true },
            { key: 'projected', label: 'Projected net worth', color: 'var(--s1)', dashed: true },
            { key: 'investments', label: 'Projected investments', color: 'var(--s2)', dashed: true },
          ]}
        />
      </ChartCard>

      <ChartCard
        title="Investment value projection"
        subtitle={`From ${dollars(t.investments)} today, adding ${dollars(inputs.monthlyInvestment)}/mo · ${inputs.expectedReturn - 2}% / ${inputs.expectedReturn}% / ${inputs.expectedReturn + 2}% returns`}
        legend={[
          { label: `High (${inputs.expectedReturn + 2}%)`, color: 'var(--s3)', type: 'line' },
          { label: `Expected (${inputs.expectedReturn}%)`, color: 'var(--s1)', type: 'line' },
          { label: `Low (${inputs.expectedReturn - 2}%)`, color: 'var(--s2)', type: 'line' },
          { label: 'Contributions only', color: 'var(--neutral-series)', type: 'dashed' },
        ]}
        table={{
          columns: [
            { key: 'year', label: 'Year' },
            { key: 'low', label: 'Low', num: true, format: dollars },
            { key: 'expected', label: 'Expected', num: true, format: dollars },
            { key: 'high', label: 'High', num: true, format: dollars },
            { key: 'contributed', label: 'Contributed', num: true, format: dollars },
          ],
          rows: inv.rows,
        }}
        footer={
          <p className="small muted" style={{ marginTop: 8 }}>
            In {years} years: {dollars(invEnd.low)} – {dollars(invEnd.high)} (expected {dollars(invEnd.expected)}), of which {dollars(invEnd.contributed)} is contributions.
            {t.investments ? ` Retirement accounts are ${pct(t.retirement / t.investments, 0)} of investments today.` : ''}
          </p>
        }
      >
        <TimeChart
          data={inv.rows}
          xKey="year"
          height={300}
          series={[
            { key: 'high', label: 'High', color: 'var(--s3)' },
            { key: 'expected', label: 'Expected', color: 'var(--s1)' },
            { key: 'low', label: 'Low', color: 'var(--s2)' },
            { key: 'contributed', label: 'Contributions only', color: 'var(--neutral-series)', dashed: true },
          ]}
        />
      </ChartCard>

      <Retirement core={core} inputs={inputs} />
    </div>
  );
}

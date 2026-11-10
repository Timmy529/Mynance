import { useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  Bar,
  BarChart,
  Cell,
  PieChart,
  Pie,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { axisMoney, dollars, pct } from '../lib/format.js';

// Categorical slots in fixed order (validated palette). Never cycled past 8:
// callers fold the tail into "Other", which uses the neutral series color.
export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
export const NEUTRAL = 'var(--neutral-series)';

// Color follows the entity: names are mapped by their position in a stable list
// (e.g. category order from settings), not by current rank.
export function colorMap(names, stableOrder = names) {
  const order = stableOrder.filter((n) => names.includes(n));
  const map = {};
  let i = 0;
  for (const n of order) {
    if (n === 'Other') continue;
    map[n] = i < SERIES.length ? SERIES[i] : NEUTRAL;
    i++;
  }
  for (const n of names) if (!map[n]) map[n] = n === 'Other' ? NEUTRAL : SERIES[Math.min(i++, SERIES.length - 1)];
  return map;
}

const axisTick = { fill: 'var(--muted)', fontSize: 12 };

export function Legend({ items }) {
  if (!items || items.length < 2) return null;
  return (
    <div className="chart-legend">
      {items.map((it) => (
        <span className="key" key={it.label}>
          {it.type === 'line' || it.type === 'dashed' ? (
            <span className={`line-key ${it.type === 'dashed' ? 'dashed' : ''}`} style={{ background: it.color, color: it.color }} />
          ) : (
            <span className="swatch" style={{ background: it.color }} />
          )}
          {it.label}
        </span>
      ))}
    </div>
  );
}

function TooltipBox({ active, payload, label, labelFormat, valueFormat, hideZero }) {
  if (!active || !payload || !payload.length) return null;
  const rows = payload.filter((p) => p.value !== null && p.value !== undefined && !(hideZero && p.value === 0));
  if (!rows.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="tt-title">{labelFormat ? labelFormat(label, payload[0]?.payload) : label}</div>
      {rows.map((p) => (
        <div className="tt-row" key={p.dataKey}>
          <span className="tt-key" style={{ background: p.color || p.stroke || p.fill }} />
          <span className="tt-value">{(p.payload?.__format?.[p.dataKey] || valueFormat || dollars)(p.value)}</span>
          <span className="tt-name">{p.name}</span>
        </div>
      ))}
    </div>
  );
}

export function DataTable({ columns, rows }) {
  return (
    <div className="table-wrap" style={{ maxHeight: 320 }}>
      <table className="table compact">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.num ? 'num' : ''}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} className={c.num ? 'num' : ''}>
                  {c.format ? c.format(r[c.key], r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Card wrapper: title, legend, and a chart/table toggle so every value is
// reachable without hovering.
export function ChartCard({ title, subtitle, legend, table, actions, children, className = '', footer }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <section className={`card ${className}`}>
      <div className="card-head">
        <div className="titles">
          <h2>{title}</h2>
          {subtitle && <div className="subtitle">{subtitle}</div>}
        </div>
        <div className="row">
          {actions}
          {table && (
            <button className="btn sm ghost" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
              {showTable ? 'Chart' : 'Table'}
            </button>
          )}
        </div>
      </div>
      {showTable && table ? (
        <DataTable columns={table.columns} rows={table.rows} />
      ) : (
        <>
          <Legend items={legend} />
          {children}
        </>
      )}
      {footer}
    </section>
  );
}

// Lines / areas over time on one y-axis.
export function TimeChart({
  data,
  xKey = 'x',
  series,
  height = 260,
  yFormat = axisMoney,
  xFormat,
  valueFormat = dollars,
  labelFormat,
  referenceX,
  referenceLabel,
  zeroLine = false,
  yDomain,
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey={xKey} tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} tickFormatter={xFormat} minTickGap={24} interval="preserveStartEnd" />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={yFormat} width={58} domain={yDomain || ['auto', 'auto']} />
        <Tooltip
          content={<TooltipBox labelFormat={labelFormat || xFormat} valueFormat={valueFormat} />}
          cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
          isAnimationActive={false}
        />
        {zeroLine && <ReferenceLine y={0} stroke="var(--axis)" />}
        {referenceX && <ReferenceLine x={referenceX} stroke="var(--axis)" label={referenceLabel ? { value: referenceLabel, position: 'insideTopLeft', fill: 'var(--muted)', fontSize: 11 } : undefined} />}
        {series.map((s) =>
          s.area ? (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              fill={s.color}
              fillOpacity={0.1}
              strokeDasharray={s.dashed ? '6 4' : undefined}
              dot={false}
              activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }}
              isAnimationActive={false}
              connectNulls={false}
            />
          ) : (
            <Line
              key={s.key}
              type={s.step ? 'stepAfter' : 'monotone'}
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? '6 4' : undefined}
              dot={false}
              activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }}
              isAnimationActive={false}
              connectNulls={false}
            />
          ),
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// Vertical bars, grouped or stacked, on one y-axis.
export function BarsChart({ data, xKey = 'x', series, stacked = false, height = 260, yFormat = axisMoney, xFormat, valueFormat = dollars, labelFormat, cellColor, zeroLine = false }) {
  const last = series.length - 1;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barGap={2} barCategoryGap="20%">
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey={xKey} tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} tickFormatter={xFormat} minTickGap={12} interval="preserveStartEnd" />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={yFormat} width={58} />
        <Tooltip
          content={<TooltipBox labelFormat={labelFormat || xFormat} valueFormat={valueFormat} hideZero={stacked} />}
          cursor={{ fill: 'var(--surface-2)' }}
          isAnimationActive={false}
        />
        {zeroLine && <ReferenceLine y={0} stroke="var(--axis)" />}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={s.color}
            stackId={stacked ? 'stack' : undefined}
            maxBarSize={24}
            radius={!stacked || i === last ? [4, 4, 0, 0] : 0}
            stroke={stacked ? 'var(--surface)' : undefined}
            strokeWidth={stacked ? 1 : 0}
            isAnimationActive={false}
          >
            {cellColor && data.map((d, idx) => <Cell key={idx} fill={cellColor(d, s)} />)}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// Donut + legend list with values and shares. Values must be >= 0.
export function Donut({ data, height = 190, format = dollars, centerLabel, centerValue }) {
  const items = data.filter((d) => d.value > 0);
  const total = items.reduce((s, d) => s + d.value, 0);
  if (!total) return <div className="empty">Nothing to show yet.</div>;
  return (
    <div className="donut-wrap">
      <div style={{ width: height, height, position: 'relative', flexShrink: 0, margin: '0 auto' }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={items} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="100%" stroke="var(--surface)" strokeWidth={2} isAnimationActive={false} startAngle={90} endAngle={-270}>
              {items.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              isAnimationActive={false}
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <div className="chart-tooltip">
                    <div className="tt-row">
                      <span className="tt-key" style={{ background: payload[0].payload.color }} />
                      <span className="tt-value">{format(payload[0].value)}</span>
                      <span className="tt-name">
                        {payload[0].name} · {pct(payload[0].value / total)}
                      </span>
                    </div>
                  </div>
                ) : null
              }
            />
          </PieChart>
        </ResponsiveContainer>
        {centerValue && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', textAlign: 'center' }}>
            <div>
              <div className="tiny muted">{centerLabel}</div>
              <div style={{ fontWeight: 650, fontSize: 17 }}>{centerValue}</div>
            </div>
          </div>
        )}
      </div>
      <div className="donut-legend">
        {items.map((d) => (
          <div className="item" key={d.name}>
            <span className="swatch" style={{ background: d.color }} />
            <span className="name">{d.name}</span>
            <span className="val">{format(d.value)}</span>
            <span className="pct">{pct(d.value / total, 0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Horizontal ranked bars (HTML) for "total by X" lists.
export function RankedBars({ items, format = dollars, color = 'var(--s1)', total }) {
  const max = Math.max(...items.map((i) => i.value), 0);
  const sum = total ?? items.reduce((s, i) => s + i.value, 0);
  return (
    <div className="list">
      {items.map((it) => (
        <div className="list-item" key={it.name} style={{ padding: '8px 0' }}>
          <div className="grow">
            <div className="row between" style={{ marginBottom: 4 }}>
              <span className="row" style={{ gap: 6, minWidth: 0 }}>
                {it.color && <span className="swatch" style={{ background: it.color }} />}
                <span className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.name}
                </span>
              </span>
              <span className="small tabular">
                <strong>{format(it.value)}</strong> <span className="muted">{sum > 0 ? pct(it.value / sum, 0) : ''}</span>
              </span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-2)' }}>
              <div style={{ height: '100%', width: `${max > 0 ? (Math.max(0, it.value) / max) * 100 : 0}%`, background: it.color || color, borderRadius: 3 }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

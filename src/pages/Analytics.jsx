import { useCallback, useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { formatUSD } from '../data/mockData';
import { useTheme } from '../lib/theme';

// One hue for every magnitude chart (brand green); text uses text tokens, never the mark color.
// Recharts draws SVG attributes, which can't read CSS variables, so colours follow the theme here.
const CHART = {
  light: { mark: '#1A4D2E', grid: '#E2E0D8', axis: '#5C6760', label: '#1F2A24', cursor: 'rgba(31, 42, 36, 0.05)' },
  dark: { mark: '#5FBF8A', grid: '#2B3631', axis: '#A7B3AC', label: '#E6ECE8', cursor: 'rgba(230, 236, 232, 0.06)' },
};
const PERIODS = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '12 months' },
  { days: 0, label: 'All time' },
];

function hoursLabel(hours) {
  if (hours == null) return '—';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${Number(hours).toFixed(1)} h`;
  return `${Math.round(hours / 24)} days`;
}
function pct(part, whole) {
  return whole ? `${Math.round((100 * part) / whole)}%` : '—';
}
function shortUSD(value) {
  const n = Number(value || 0);
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}k`;
  return `$${Math.round(n)}`;
}

export default function Analytics() {
  const [days, setDays] = useState(90);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: result, error: rpcError } = await supabase.rpc('analytics_summary', { p_days: days });
    if (rpcError) setError(rpcError.message);
    else setData(result);
    setLoading(false);
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const k = data?.kpis || {};
  const o = data?.outreach || {};
  const funnel = (data?.funnel || []).map((row, i, all) => ({
    ...row,
    share: pct(row.count, all[0]?.count),
  }));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Analytics</h1>
          <p>Pipeline, conversion, revenue, lead sources and response times.</p>
        </div>
        <button className="btn btn-secondary" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />} Refresh
        </button>
      </div>

      <div className="analytics-filters" role="tablist" aria-label="Period">
        {PERIODS.map((p) => (
          <button key={p.days} type="button" role="tab" aria-selected={days === p.days}
            className={'tab' + (days === p.days ? ' active' : '')} onClick={() => setDays(p.days)}>
            {p.label}
          </button>
        ))}
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {!data && loading ? (
        <div className="loading-inline"><Loader2 className="spin" size={18} /> Loading…</div>
      ) : data && (
        <div style={{ opacity: loading ? 0.6 : 1 }}>
          <div className="analytics-kpis">
            <Kpi label="Open pipeline" value={shortUSD(Number(k.open_inquiry_value) + Number(k.open_order_value))}
              note={`${k.open_inquiries} open inquiries · ${k.open_orders} open orders`} />
            <Kpi label="Order value" value={shortUSD(k.order_value)} note={`${k.orders} orders in this period`} />
            <Kpi label="Inquiry to order" value={k.conversion_pct == null ? '—' : `${k.conversion_pct}%`} note={`of ${k.inquiries} inquiries in this period`} />
            <Kpi label="Median reply time" value={hoursLabel(k.median_reply_hours)} note={k.replied_count ? `${k.replied_within_4h_pct}% answered within 4 hours` : 'No replies logged yet'} />
          </div>

          <div className="analytics-grid">
            <ChartCard title="Inquiry funnel" sub="Inquiries received in this period and the furthest stage each reached."
              table={{ head: ['Stage', 'Inquiries', 'Of received'], rows: funnel.map((f) => [f.stage, f.count, f.share]) }}>
              <HBar data={funnel} dataKey="count" labelKey="stage" height={funnel.length * 44 + 20}
                format={(v) => v} tooltip={(row) => `${row.count} inquiries · ${row.share} of received`} />
            </ChartCard>

            <ChartCard title="Revenue by country" sub="Order value in this period, top 10."
              table={{ head: ['Country', 'Order value', 'Orders'], rows: (data.revenue_by_country || []).map((r) => [r.label, formatUSD(r.value), r.orders]) }}>
              {(data.revenue_by_country || []).length ? (
                <HBar data={data.revenue_by_country} dataKey="value" labelKey="label" height={data.revenue_by_country.length * 44 + 20}
                  format={shortUSD} tooltip={(row) => `${formatUSD(row.value)} · ${row.orders} order${row.orders === 1 ? '' : 's'}`} />
              ) : <Empty />}
            </ChartCard>

            <ChartCard title="Inquiries per month" sub="Last 12 months, all channels."
              table={{ head: ['Month', 'Inquiries'], rows: (data.monthly || []).map((m) => [m.month, m.inquiries]) }}>
              <Columns data={data.monthly || []} dataKey="inquiries" format={(v) => v} tooltip={(row) => `${row.inquiries} inquiries`} />
            </ChartCard>

            <ChartCard title="Order value per month" sub="Last 12 months."
              table={{ head: ['Month', 'Order value'], rows: (data.monthly || []).map((m) => [m.month, formatUSD(m.order_value)]) }}>
              <Columns data={data.monthly || []} dataKey="order_value" format={shortUSD} tooltip={(row) => formatUSD(row.order_value)} />
            </ChartCard>

            <ChartCard title="Revenue by product" sub="Order lines in this period, top 10."
              table={{ head: ['Product', 'Value', 'MT'], rows: (data.revenue_by_product || []).map((r) => [r.label, formatUSD(r.value), Number(r.mt || 0)]) }}>
              {(data.revenue_by_product || []).length ? (
                <HBar data={data.revenue_by_product} dataKey="value" labelKey="label" height={data.revenue_by_product.length * 44 + 20}
                  format={shortUSD} tooltip={(row) => `${formatUSD(row.value)} · ${Number(row.mt || 0)} MT`} />
              ) : <Empty />}
            </ChartCard>

            <div className="card analytics-card">
              <div className="card-header"><div><h3>Email outreach</h3><div className="card-header-sub">Emails sent in this period.</div></div></div>
              <div className="analytics-mini-kpis">
                <Kpi small label="Sent" value={o.sent} />
                <Kpi small label="Opened" value={pct(o.opened, o.sent)} note={`${o.opened} emails`} />
                <Kpi small label="Replied" value={pct(o.replied, o.sent)} note={`${o.replied} emails`} />
                <Kpi small label="Bounced" value={pct(o.bounced, o.sent)} note={`${o.bounced} emails`} />
                <Kpi small label="Replies turned into inquiries" value={o.inquiries_from_replies} />
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-header"><div><h3>Lead sources</h3><div className="card-header-sub">Buyers by where they came from; inquiries, orders and revenue in this period.</div></div></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Source</th><th>Buyers</th><th>Contacted</th><th>With inquiry</th><th>With order</th><th>Revenue</th></tr></thead>
                <tbody>
                  {(data.sources || []).map((s) => (
                    <tr key={s.source}>
                      <td className="cell-strong">{s.source}</td>
                      <td className="num">{s.clients}</td>
                      <td className="num">{s.contacted} <span className="cell-muted">({pct(s.contacted, s.clients)})</span></td>
                      <td className="num">{s.with_inquiry}</td>
                      <td className="num">{s.with_order}</td>
                      <td className="num">{formatUSD(s.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, note, small }) {
  return (
    <div className={'card analytics-kpi' + (small ? ' small' : '')}>
      <span className="analytics-kpi-label">{label}</span>
      <strong className="analytics-kpi-value">{value ?? '—'}</strong>
      {note && <span className="analytics-kpi-note">{note}</span>}
    </div>
  );
}

function ChartCard({ title, sub, table, children }) {
  return (
    <div className="card analytics-card">
      <div className="card-header"><div><h3>{title}</h3>{sub && <div className="card-header-sub">{sub}</div>}</div></div>
      {children}
      {table && table.rows.length > 0 && (
        <details className="analytics-table">
          <summary>View as table</summary>
          <table>
            <thead><tr>{table.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody>
          </table>
        </details>
      )}
    </div>
  );
}

function Empty() {
  return <p className="buyer-profile-notes">No orders in this period.</p>;
}

function ChartTooltip({ active, payload, render }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="analytics-tooltip">
      <strong>{row.label || row.stage || row.month}</strong>
      <span>{render(row)}</span>
    </div>
  );
}

// Horizontal bars: magnitude by category, value at the bar tip.
function HBar({ data, dataKey, labelKey, height, format, tooltip }) {
  const { theme } = useTheme();
  const c = CHART[theme] || CHART.light;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 4 }} barCategoryGap={8}>
        <CartesianGrid horizontal={false} stroke={c.grid} strokeWidth={1} />
        <XAxis type="number" hide domain={[0, 'dataMax']} />
        <YAxis type="category" dataKey={labelKey} width={150} tickLine={false} axisLine={false}
          tick={{ fill: c.axis, fontSize: 12 }} tickFormatter={(v) => (String(v).length > 22 ? `${String(v).slice(0, 21)}…` : v)} />
        <Tooltip cursor={{ fill: c.cursor }} content={<ChartTooltip render={tooltip} />} />
        <Bar dataKey={dataKey} fill={c.mark} barSize={20} radius={[0, 4, 4, 0]} isAnimationActive={false}>
          <LabelList dataKey={dataKey} position="right" formatter={format} style={{ fill: c.label, fontSize: 12, fontWeight: 600 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// Columns over time, value in the tooltip; axis ticks carry the scale.
function Columns({ data, dataKey, format, tooltip }) {
  const { theme } = useTheme();
  const c = CHART[theme] || CHART.light;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid vertical={false} stroke={c.grid} strokeWidth={1} />
        <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: c.grid }} tick={{ fill: c.axis, fontSize: 11 }} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} tick={{ fill: c.axis, fontSize: 11 }} tickFormatter={format} width={48} allowDecimals={false} />
        <Tooltip cursor={{ fill: c.cursor }} content={<ChartTooltip render={tooltip} />} />
        <Bar dataKey={dataKey} fill={c.mark} barSize={18} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

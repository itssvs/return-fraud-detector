import { useEffect, useMemo, useState } from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
} from 'recharts';

const API_BASE = 'http://localhost:8000';

const COLORS = {
  bg: '#05070E',
  glass: 'rgba(13, 18, 32, 0.55)',
  glassBorder: 'rgba(255, 255, 255, 0.08)',
  cyan: '#00E5FF',
  violet: '#B24BF3',
  danger: '#FF3B69',
  warning: '#FFB020',
  success: '#00FFA3',
  textMuted: '#AAB4D4',
};

const RISK_COLORS = { High: COLORS.danger, Medium: COLORS.warning, Low: COLORS.success };

function GlassCard({ children, className = '', glow }) {
  return (
    <div
      className={`relative rounded-2xl border backdrop-blur-xl ${className}`}
      style={{
        background: COLORS.glass,
        borderColor: COLORS.glassBorder,
        boxShadow: glow
          ? `0 0 40px -12px ${glow}55, inset 0 1px 0 0 rgba(255,255,255,0.04)`
          : 'inset 0 1px 0 0 rgba(255,255,255,0.04)',
      }}
    >
      {children}
    </div>
  );
}

function riskGlow(level) {
  return RISK_COLORS[level] || COLORS.cyan;
}

function RiskRing({ score, level }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = riskGlow(level);

  return (
    <div className="relative flex h-36 w-36 items-center justify-center">
      <svg width="140" height="140" className="-rotate-90">
        <circle cx="70" cy="70" r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
        <circle
          cx="70" cy="70" r={radius} fill="none"
          stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ filter: `drop-shadow(0 0 8px ${color}aa)`, transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="font-mono text-3xl font-bold" style={{ color }}>{score}</span>
        <span className="text-[10px] uppercase tracking-widest text-slate-500">Risk Score</span>
      </div>
    </div>
  );
}

export default function App() {
  const [summary, setSummary] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [linkedAccounts, setLinkedAccounts] = useState(null);
  const [recommendations, setRecommendations] = useState(null);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [histogram, setHistogram] = useState([]);
  const [topReasons, setTopReasons] = useState([]);
  const [language, setLanguage] = useState('English');
  const [translatedText, setTranslatedText] = useState(null);
  const [translating, setTranslating] = useState(false);
  const [riskFilter, setRiskFilter] = useState('High');
  const [loading, setLoading] = useState(true);
  const [scoring, setScoring] = useState(false);
  const [error, setError] = useState('');

  const fetchSummary = async () => {
    const res = await fetch(`${API_BASE}/dashboard/summary`);
    if (!res.ok) throw new Error('Failed to load dashboard summary');
    setSummary(await res.json());
  };

  const fetchCustomers = async (level = riskFilter) => {
    const params = new URLSearchParams({
      risk_level: level, sort_by: 'risk_score', page: '1', page_size: '25',
    });
    const res = await fetch(`${API_BASE}/dashboard/customers?${params}`);
    if (!res.ok) throw new Error('Failed to load customers');
    const data = await res.json();
    setCustomers(data.results || []);
  };

  const fetchHistogram = async () => {
    try {
      const res = await fetch(`${API_BASE}/dashboard/risk-histogram`);
      if (!res.ok) return;
      const data = await res.json();
      setHistogram(data.histogram || []);
      setTopReasons(data.top_reasons || []);
    } catch {
      // non-critical, skip silently
    }
  };

  const loadDashboard = async (level = riskFilter) => {
    setError('');
    setLoading(true);
    try {
      await Promise.all([fetchSummary(), fetchCustomers(level), fetchHistogram()]);
    } catch (err) {
      setError(err.message || 'Dashboard failed to load');
    } finally {
      setLoading(false);
    }
  };

  const scoreAllCustomers = async () => {
    setError('');
    setScoring(true);
    try {
      const res = await fetch(`${API_BASE}/score-all-customers`, { method: 'POST' });
      if (!res.ok) throw new Error('Batch scoring failed');
      await loadDashboard(riskFilter);
    } catch (err) {
      setError(err.message || 'Batch scoring failed');
    } finally {
      setScoring(false);
    }
  };

  const selectCustomer = async (customer) => {
    setSelectedCustomer(null);
    setLinkedAccounts(null);
    setRecommendations(null);
    setError('');

    try {
      const detailRes = await fetch(`${API_BASE}/dashboard/customer/${customer.customer_id}`);
      if (!detailRes.ok) throw new Error('Failed to load customer detail');
      const detail = await detailRes.json();
      setSelectedCustomer(detail);

      setRecommendationsLoading(true);
      try {
        const recRes = await fetch(`${API_BASE}/dashboard/customer/${detail.customer_id}/recommendations`);
        if (recRes.ok) setRecommendations(await recRes.json());
      } finally {
        setRecommendationsLoading(false);
      }

      if (detail.phone_hash) {
        const linkedRes = await fetch(`${API_BASE}/dashboard/linked-accounts/${detail.phone_hash}`);
        if (linkedRes.ok) setLinkedAccounts(await linkedRes.json());
      }
    } catch (err) {
      setError(err.message || 'Failed to load customer detail');
      setRecommendationsLoading(false);
    }
  };

  useEffect(() => { loadDashboard('High'); }, []);

  const riskDistribution = useMemo(() => {
    if (!summary) return [];
    return [
      { name: 'High', value: summary.high_risk_count || 0, color: COLORS.danger },
      { name: 'Medium', value: summary.medium_risk_count || 0, color: COLORS.warning },
      { name: 'Low', value: summary.low_risk_count || 0, color: COLORS.success },
    ];
  }, [summary]);

  const total = summary?.total_customers || 0;

  const handleFilterChange = async (level) => {
    setRiskFilter(level);
    setSelectedCustomer(null);
    setLinkedAccounts(null);
    await loadDashboard(level);
  };

  const t = (key, fallback) => translatedText?.[key] || fallback;

  const translateDashboard = async (targetLanguage) => {
    setLanguage(targetLanguage);
    setTranslatedText(null);
    if (targetLanguage === 'English') return;
    setTranslating(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_language: targetLanguage,
          content: {
            title: ' BUSTED-Retail Risk Intelligence Dashboard',
            subtitle: 'Live anomaly scores, flagged accounts, and cross-platform phone hash linking.',
            total_customers: 'Total Customers', high_risk: 'High Risk', medium_risk: 'Medium Risk',
            low_risk: 'Low Risk', avg_risk_score: 'Avg Risk Score', risk_distribution: 'Risk Distribution',
            flagged_accounts: 'Flagged Accounts', sorted_by_highest: 'Sorted by highest risk score',
            customer: 'Customer', risk: 'Risk', level: 'Level', phone_hash: 'Phone Hash',
            customer_detail: 'Customer Detail', customer_id: 'Customer ID', risk_score: 'Risk Score',
            top_reasons: 'Top Reasons', linked_accounts: 'Linked Accounts',
            aggregate_risk_score: 'Aggregate Risk Score', policy_recommendations: 'AI Policy Recommendations',
            select_customer_detail: 'Select a flagged account to inspect model reasons.',
            select_linked_accounts: 'Select a customer to reveal accounts sharing the same hashed phone number.',
            select_customer_recommendations: 'Select a flagged account to generate policy recommendations.',
            no_recommendations: 'No recommendations loaded.', generating_recommendations: 'Generating recommendations...',
            confidence: 'Confidence', refresh: 'Refresh', score_dataset: 'Score Dataset',
            scoring_label: 'Scoring...', loading_dashboard: 'Loading dashboard...',
            no_customers_found: 'No customers found for this risk level.', translating_label: 'Translating...',
            score_distribution: 'Score Distribution', top_flagged_reasons: 'Top Flagged Reasons',
            customers_label: 'customers',
          },
        }),
      });
      if (!res.ok) throw new Error('Translation failed');
      const data = await res.json();
      setTranslatedText(data.translated_content || null);
    } catch (err) {
      setError(err.message || 'Translation failed');
    } finally {
      setTranslating(false);
    }
  };

  return (
    <div className="min-h-screen text-slate-100" style={{ background: COLORS.bg, fontFamily: "'Inter', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />

      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: `linear-gradient(${COLORS.cyan}22 1px, transparent 1px), linear-gradient(90deg, ${COLORS.cyan}22 1px, transparent 1px)`,
            backgroundSize: '48px 48px',
            maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)',
            WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)',
          }}
        />
        <div
          className="absolute left-0 right-0 h-px opacity-40"
          style={{
            background: `linear-gradient(90deg, transparent, ${COLORS.cyan}, transparent)`,
            animation: 'scanline 8s linear infinite',
          }}
        />
        <style>{`
          @keyframes scanline {
            0% { top: -5%; }
            100% { top: 105%; }
          }
        `}</style>
      </div>

      <div className="relative mx-auto max-w-7xl px-5 py-8 space-y-6">
        <header className="flex flex-col gap-4 pb-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em]" style={{ color: COLORS.cyan }}>
              Fraud Intelligence
            </p>
            <h1 className="mt-2 text-4xl font-bold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              {t('title', 'BUSTED-Retail Risk Intelligence Dashboard')}
            </h1>
            <p className="mt-2 text-sm" style={{ color: COLORS.textMuted }}>
              {t('subtitle', 'Live anomaly scores, flagged accounts, and cross-platform phone hash linking.')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <select
              value={language}
              onChange={(e) => translateDashboard(e.target.value)}
              className="rounded-xl border px-3 py-2 text-sm text-slate-200 backdrop-blur-xl"
              style={{ background: COLORS.glass, borderColor: COLORS.glassBorder }}
            >
              <option>English</option><option>Hindi</option><option>Spanish</option>
              <option>French</option><option>Tamil</option><option>Telugu</option>
            </select>

            {translating && <span className="text-sm" style={{ color: COLORS.textMuted }}>{t('translating_label', 'Translating...')}</span>}

            <button
              onClick={() => loadDashboard(riskFilter)}
              className="rounded-xl border px-4 py-2 text-sm font-medium backdrop-blur-xl transition hover:brightness-125"
              style={{ background: COLORS.glass, borderColor: COLORS.glassBorder }}
            >
              {t('refresh', 'Refresh')}
            </button>

            <button
              onClick={scoreAllCustomers}
              disabled={scoring}
              className="rounded-xl px-5 py-2 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:opacity-60"
              style={{ background: `linear-gradient(135deg, ${COLORS.cyan}, ${COLORS.violet})`, boxShadow: `0 0 24px -6px ${COLORS.cyan}88` }}
            >
              {scoring ? t('scoring_label', 'Scoring...') : t('score_dataset', 'Score Dataset')}
            </button>
          </div>
        </header>

        {error && (
          <GlassCard className="px-4 py-3 text-sm" glow={COLORS.danger}>
            <span style={{ color: COLORS.danger }}>{error}</span>
          </GlassCard>
        )}

        {loading ? (
          <GlassCard className="p-8 text-center text-sm" style={{ color: COLORS.textMuted }}>
            {t('loading_dashboard', 'Loading dashboard...')}
          </GlassCard>
        ) : (
          <>
            <section className="grid gap-4 md:grid-cols-5">
              <MetricCard label={t('total_customers', 'Total Customers')} value={summary?.total_customers ?? 0} color={COLORS.cyan} />
              <MetricCard label={t('high_risk', 'High Risk')} value={summary?.high_risk_count ?? 0} color={COLORS.danger} />
              <MetricCard label={t('medium_risk', 'Medium Risk')} value={summary?.medium_risk_count ?? 0} color={COLORS.warning} />
              <MetricCard label={t('low_risk', 'Low Risk')} value={summary?.low_risk_count ?? 0} color={COLORS.success} />
              <MetricCard label={t('avg_risk_score', 'Avg Risk Score')} value={Number(summary?.avg_risk_score || 0).toFixed(1)} color={COLORS.violet} />
            </section>

            <section className="grid gap-5 lg:grid-cols-3">
              <GlassCard className="p-5 lg:col-span-1" glow={COLORS.cyan}>
                <h2 className="text-lg font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                  {t('risk_distribution', 'Risk Distribution')}
                </h2>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={riskDistribution} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
                      {riskDistribution.map((entry, i) => (
                        <Cell key={i} fill={entry.color} stroke={COLORS.bg} strokeWidth={2} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#0D1220', border: `1px solid ${COLORS.glassBorder}`, borderRadius: 12, color: '#fff' }} />
                    <Legend verticalAlign="bottom" height={24} formatter={(v) => <span style={{ color: COLORS.textMuted, fontSize: 12 }}>{v}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              </GlassCard>

              <GlassCard className="p-5 lg:col-span-2" glow={COLORS.violet}>
                <h2 className="text-lg font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                  {t('score_distribution', 'Score Distribution')}
                </h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={histogram}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="range" stroke={COLORS.textMuted} fontSize={12} />
                    <YAxis stroke={COLORS.textMuted} fontSize={12} />
                    <Tooltip contentStyle={{ background: '#0D1220', border: `1px solid ${COLORS.glassBorder}`, borderRadius: 12, color: '#fff' }} />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                      {histogram.map((entry, i) => {
                        const colors = [COLORS.success, COLORS.success, COLORS.warning, COLORS.warning, COLORS.danger];
                        return <Cell key={i} fill={colors[i] || COLORS.cyan} />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </GlassCard>
            </section>

            {topReasons.length > 0 && (
              <GlassCard className="p-5" glow={COLORS.cyan}>
                <h2 className="text-lg font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                  {t('top_flagged_reasons', 'Top Flagged Reasons')}
                </h2>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={topReasons} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
                    <XAxis type="number" stroke={COLORS.textMuted} fontSize={12} />
                    <YAxis type="category" dataKey="reason" width={220} stroke={COLORS.textMuted} fontSize={11} />
                    <Tooltip contentStyle={{ background: '#0D1220', border: `1px solid ${COLORS.glassBorder}`, borderRadius: 12, color: '#fff' }} />
                    <Bar dataKey="count" fill={COLORS.cyan} radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </GlassCard>
            )}

            <section className="grid gap-5 lg:grid-cols-3">
              <GlassCard className="p-5 lg:col-span-2" glow={COLORS.cyan}>
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                      {t('flagged_accounts', 'Flagged Accounts')}
                    </h2>
                    <p className="text-sm" style={{ color: COLORS.textMuted }}>{t('sorted_by_highest', 'Sorted by highest risk score')}</p>
                  </div>
                  <div className="flex rounded-xl border p-1" style={{ borderColor: COLORS.glassBorder }}>
                    {['High', 'Medium', 'Low'].map((level) => (
                      <button
                        key={level}
                        onClick={() => handleFilterChange(level)}
                        className="rounded-lg px-3 py-1.5 text-sm font-medium transition"
                        style={riskFilter === level
                          ? { background: riskGlow(level), color: '#05070E' }
                          : { color: COLORS.textMuted }}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-5 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b" style={{ borderColor: COLORS.glassBorder, color: COLORS.textMuted }}>
                        <th className="py-3 pr-3 font-medium">{t('customer', 'Customer')}</th>
                        <th className="py-3 pr-3 font-medium">{t('risk', 'Risk')}</th>
                        <th className="py-3 pr-3 font-medium">{t('level', 'Level')}</th>
                        <th className="py-3 pr-3 font-medium">{t('phone_hash', 'Phone Hash')}</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-xs">
                      {customers.map((customer) => (
                        <tr
                          key={customer.customer_id}
                          onClick={() => selectCustomer(customer)}
                          className="cursor-pointer border-b transition hover:bg-white/5"
                          style={{ borderColor: 'rgba(255,255,255,0.04)' }}
                        >
                          <td className="py-3 pr-3 font-sans font-medium text-slate-100">{customer.customer_id}</td>
                          <td className="py-3 pr-3">
                            <div className="flex items-center gap-3">
                              <span className="w-8 font-semibold" style={{ color: riskGlow(customer.risk_level) }}>{customer.risk_score}</span>
                              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
                                <div className="h-full rounded-full" style={{ width: `${customer.risk_score}%`, background: riskGlow(customer.risk_level), boxShadow: `0 0 8px ${riskGlow(customer.risk_level)}` }} />
                              </div>
                            </div>
                          </td>
                          <td className="py-3 pr-3 font-sans">
                            <span
                              className="rounded-full border px-2 py-1 text-xs font-semibold"
                              style={{ borderColor: riskGlow(customer.risk_level), color: riskGlow(customer.risk_level), background: `${riskGlow(customer.risk_level)}15` }}
                            >
                              {customer.risk_level}
                            </span>
                          </td>
                          <td className="max-w-xs truncate py-3 pr-3" style={{ color: COLORS.textMuted }}>
                            {customer.phone_hash}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {customers.length === 0 && (
                    <p className="py-8 text-center text-sm" style={{ color: COLORS.textMuted }}>
                      {t('no_customers_found', 'No customers found for this risk level.')}
                    </p>
                  )}
                </div>
              </GlassCard>

              <GlassCard className="flex flex-col items-center justify-center p-5" glow={selectedCustomer ? riskGlow(selectedCustomer.risk_level) : COLORS.cyan}>
                <h2 className="mb-3 self-start text-lg font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                  {t('customer_detail', 'Customer Detail')}
                </h2>
                {!selectedCustomer ? (
                  <p className="text-center text-sm" style={{ color: COLORS.textMuted }}>
                    {t('select_customer_detail', 'Select a flagged account to inspect model reasons.')}
                  </p>
                ) : (
                  <>
                    <RiskRing score={selectedCustomer.risk_score} level={selectedCustomer.risk_level} />
                    <p className="mt-3 font-mono text-sm text-slate-300">{selectedCustomer.customer_id}</p>
                  </>
                )}
              </GlassCard>
            </section>

            {selectedCustomer && (
              <section className="grid gap-5 lg:grid-cols-2">
                <GlassCard className="p-5" glow={COLORS.cyan}>
                  <p className="mb-3 text-sm font-medium" style={{ color: COLORS.textMuted }}>{t('top_reasons', 'Top Reasons')}</p>
                  <div className="space-y-2">
                    {(selectedCustomer.reasons || []).map((reason, index) => (
                      <div key={index} className="rounded-xl border px-3 py-2 text-sm" style={{ borderColor: COLORS.glassBorder, background: 'rgba(255,255,255,0.03)' }}>
                        {reason}
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {Object.entries(selectedCustomer.features || {}).map(([key, value]) => (
                      <div key={key} className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
                        <p className="text-xs" style={{ color: COLORS.textMuted }}>{key}</p>
                        <p className="mt-1 font-mono font-semibold text-slate-200">{Number(value).toFixed(3)}</p>
                      </div>
                    ))}
                  </div>
                </GlassCard>

                <GlassCard className="p-5" glow={COLORS.violet}>
                  <h2 className="text-lg font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                    {t('linked_accounts', 'Linked Accounts')}
                  </h2>
                  {!linkedAccounts ? (
                    <p className="mt-4 text-sm" style={{ color: COLORS.textMuted }}>
                      {t('select_linked_accounts', 'Select a customer to reveal accounts sharing the same hashed phone number.')}
                    </p>
                  ) : (
                    <div className="mt-4 space-y-4">
                      <div className="rounded-xl border p-4" style={{ borderColor: `${COLORS.violet}55`, background: `${COLORS.violet}0D` }}>
                        <p className="text-sm" style={{ color: COLORS.violet }}>{t('aggregate_risk_score', 'Aggregate Risk Score')}</p>
                        <p className="mt-1 font-mono text-3xl font-bold" style={{ color: COLORS.violet }}>
                          {Number(linkedAccounts.aggregate_risk_score || 0).toFixed(0)}
                        </p>
                      </div>
                      <div className="space-y-2">
                        {(linkedAccounts.linked_accounts || []).map((account) => (
                          <div key={account.customer_id} className="flex items-center justify-between rounded-xl px-3 py-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
                            <p className="font-mono text-sm">{account.customer_id}</p>
                            <span className="rounded-full border px-2 py-1 text-xs font-semibold" style={{ borderColor: riskGlow(account.risk_level), color: riskGlow(account.risk_level) }}>
                              {account.risk_score} / {account.risk_level}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </GlassCard>
              </section>
            )}

            <GlassCard className="p-5" glow={COLORS.cyan}>
              <h2 className="text-lg font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                {t('policy_recommendations', 'AI Policy Recommendations')}
              </h2>
              {!selectedCustomer ? (
                <p className="mt-4 text-sm" style={{ color: COLORS.textMuted }}>{t('select_customer_recommendations', 'Select a flagged account to generate policy recommendations.')}</p>
              ) : recommendationsLoading ? (
                <p className="mt-4 text-sm" style={{ color: COLORS.textMuted }}>{t('generating_recommendations', 'Generating recommendations...')}</p>
              ) : !recommendations?.recommendations?.length ? (
                <p className="mt-4 text-sm" style={{ color: COLORS.textMuted }}>{t('no_recommendations', 'No recommendations loaded.')}</p>
              ) : (
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  {recommendations.recommendations.map((item, index) => (
                    <div key={index} className="rounded-xl border p-4" style={{ borderColor: COLORS.glassBorder, background: 'rgba(255,255,255,0.03)' }}>
                      <p className="font-semibold text-slate-100">{item.title}</p>
                      <p className="mt-1 text-sm" style={{ color: COLORS.cyan }}>{item.action}</p>
                      <p className="mt-3 text-sm" style={{ color: COLORS.textMuted }}>{item.reason}</p>
                      <p className="mt-2 text-xs" style={{ color: COLORS.textMuted }}>{t('confidence', 'Confidence')}: {item.confidence}%</p>
                    </div>
                  ))}
                </div>
              )}
            </GlassCard>
          </>
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value, color }) {
  return (
    <GlassCard className="p-4" glow={color}>
      <p className="text-sm" style={{ color: COLORS.textMuted }}>{label}</p>
      <p className="mt-2 font-mono text-2xl font-bold" style={{ color, fontFamily: "'Space Grotesk', sans-serif" }}>{value}</p>
    </GlassCard>
  );
}
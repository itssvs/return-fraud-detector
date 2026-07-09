import { useEffect, useMemo, useState } from 'react';

const API_BASE = 'http://localhost:8000';

function riskBadgeStyles(level) {
  switch (level) {
    case 'High':
      return 'bg-red-100 text-red-700 border-red-200';
    case 'Medium':
      return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'Low':
    default:
      return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  }
}

function scoreColor(score) {
  if (score >= 70) return 'bg-red-500';
  if (score >= 40) return 'bg-amber-500';
  return 'bg-emerald-500';
}

export default function App() {
  const [summary, setSummary] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [linkedAccounts, setLinkedAccounts] = useState(null);
  const [recommendations, setRecommendations] = useState(null);
const [recommendationsLoading, setRecommendationsLoading] = useState(false);
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
      risk_level: level,
      sort_by: 'risk_score',
      page: '1',
      page_size: '25',
    });

    const res = await fetch(`${API_BASE}/dashboard/customers?${params}`);
    if (!res.ok) throw new Error('Failed to load customers');
    const data = await res.json();
    setCustomers(data.results || []);
  };

  const loadDashboard = async (level = riskFilter) => {
    setError('');
    setLoading(true);

    try {
      await Promise.all([fetchSummary(), fetchCustomers(level)]);
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
      const res = await fetch(`${API_BASE}/score-all-customers`, {
        method: 'POST',
      });

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
      if (recRes.ok) {
        const recData = await recRes.json();
        setRecommendations(recData);
      }
    } finally {
      setRecommendationsLoading(false);
    }

    if (detail.phone_hash) {
      const linkedRes = await fetch(`${API_BASE}/dashboard/linked-accounts/${detail.phone_hash}`);
      if (linkedRes.ok) {
        setLinkedAccounts(await linkedRes.json());
      }
    }
  } catch (err) {
    setError(err.message || 'Failed to load customer detail');
    setRecommendationsLoading(false);
  }
};

  useEffect(() => {
    loadDashboard('High');
  }, []);

  const riskDistribution = useMemo(() => {
    if (!summary) return [];

    return [
      { label: 'High', count: summary.high_risk_count || 0, color: 'bg-red-500' },
      { label: 'Medium', count: summary.medium_risk_count || 0, color: 'bg-amber-500' },
      { label: 'Low', count: summary.low_risk_count || 0, color: 'bg-emerald-500' },
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
  title: 'Retail Risk Intelligence Dashboard',
  subtitle: 'Live anomaly scores, flagged accounts, and cross-platform phone hash linking.',
  total_customers: 'Total Customers',
  high_risk: 'High Risk',
  medium_risk: 'Medium Risk',
  low_risk: 'Low Risk',
  avg_risk_score: 'Avg Risk Score',
  risk_distribution: 'Risk Distribution',
  flagged_accounts: 'Flagged Accounts',
  sorted_by_highest: 'Sorted by highest risk score',
  customer: 'Customer',
  risk: 'Risk',
  level: 'Level',
  phone_hash: 'Phone Hash',
  customer_detail: 'Customer Detail',
  customer_id: 'Customer ID',
  risk_score: 'Risk Score',
  top_reasons: 'Top Reasons',
  linked_accounts: 'Linked Accounts',
  aggregate_risk_score: 'Aggregate Risk Score',
  policy_recommendations: 'AI Policy Recommendations',
  select_customer_detail: 'Select a flagged account to inspect model reasons.',
  select_linked_accounts: 'Select a customer to reveal accounts sharing the same hashed phone number.',
  select_customer_recommendations: 'Select a flagged account to generate policy recommendations.',
  no_recommendations: 'No recommendations loaded.',
  generating_recommendations: 'Generating recommendations...',
  confidence: 'Confidence',
  refresh: 'Refresh',
  score_dataset: 'Score Dataset',
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
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-5 py-6 space-y-6">
        <header className="flex flex-col gap-4 border-b border-slate-800 pb-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium text-cyan-300">BUSTED</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">
  {t('title', 'Retail Risk Intelligence Dashboard')}
</h1>
<p className="mt-2 text-sm text-slate-400">
  {t('subtitle', 'Live anomaly scores, flagged accounts, and cross-platform phone hash linking.')}
</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
  <select
    value={language}
    onChange={(e) => translateDashboard(e.target.value)}
    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
  >
    <option>English</option>
    <option>Hindi</option>
    <option>Spanish</option>
    <option>French</option>
    <option>Tamil</option>
    <option>Telugu</option>
  </select>

  {translating && <span className="text-sm text-slate-400">Translating...</span>}

  <button
    onClick={() => loadDashboard(riskFilter)}
    className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-900"
  >
    Refresh
  </button>

  <button
    onClick={scoreAllCustomers}
    disabled={scoring}
    className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-60"
  >
    {scoring ? 'Scoring...' : 'Score Dataset'}
  </button>
</div>
        </header>

        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-8 text-slate-300">
            Loading dashboard...
          </div>
        ) : (
          <>
            <section className="grid gap-4 md:grid-cols-5">
              <MetricCard label={t('total_customers', 'Total Customers')} value={summary?.total_customers ?? 0} />
<MetricCard label={t('high_risk', 'High Risk')} value={summary?.high_risk_count ?? 0} tone="red" />
<MetricCard label={t('medium_risk', 'Medium Risk')} value={summary?.medium_risk_count ?? 0} tone="amber" />
<MetricCard label={t('low_risk', 'Low Risk')} value={summary?.low_risk_count ?? 0} tone="emerald" />
              <MetricCard
                label={t('avg_risk_score', 'Avg Risk Score')}
                value={Number(summary?.avg_risk_score || 0).toFixed(1)}
                tone="cyan"
              />
            </section>

            <section className="grid gap-5 lg:grid-cols-3">
              <div className="rounded-lg border border-slate-800 bg-slate-900 p-5 lg:col-span-1">
               <h2 className="text-lg font-semibold">{t('risk_distribution', 'Risk Distribution')}</h2>
                <div className="mt-5 space-y-4">
                  {riskDistribution.map((item) => {
                    const pct = total ? (item.count / total) * 100 : 0;

                    return (
                      <div key={item.label}>
                        <div className="mb-2 flex items-center justify-between text-sm">
                          <span className="text-slate-300">{item.label}</span>
                          <span className="font-semibold">{item.count.toLocaleString()}</span>
                        </div>
                        <div className="h-3 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className={`h-full ${item.color}`}
                            style={{ width: `${Math.max(pct, item.count > 0 ? 2 : 0)}%` }}
                          />
                        </div>
                        <p className="mt-1 text-xs text-slate-500">{pct.toFixed(2)}% of customers</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900 p-5 lg:col-span-2">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">Flagged Accounts</h2>
                    <p className="text-sm text-slate-400">Sorted by highest risk score</p>
                  </div>

                  <div className="flex rounded-lg border border-slate-700 p-1">
                    {['High', 'Medium', 'Low'].map((level) => (
                      <button
                        key={level}
                        onClick={() => handleFilterChange(level)}
                        className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                          riskFilter === level
                            ? 'bg-cyan-400 text-slate-950'
                            : 'text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-5 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="py-3 pr-3 font-medium">Customer</th>
                        <th className="py-3 pr-3 font-medium">Risk</th>
                        <th className="py-3 pr-3 font-medium">Level</th>
                        <th className="py-3 pr-3 font-medium">Phone Hash</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customers.map((customer) => (
                        <tr
                          key={customer.customer_id}
                          onClick={() => selectCustomer(customer)}
                          className="cursor-pointer border-b border-slate-800/70 hover:bg-slate-800"
                        >
                          <td className="py-3 pr-3 font-medium text-slate-100">{customer.customer_id}</td>
                          <td className="py-3 pr-3">
                            <div className="flex items-center gap-3">
                              <span className="w-8 font-semibold">{customer.risk_score}</span>
                              <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-700">
                                <div
                                  className={`h-full ${scoreColor(customer.risk_score)}`}
                                  style={{ width: `${customer.risk_score}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="py-3 pr-3">
                            <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${riskBadgeStyles(customer.risk_level)}`}>
                              {customer.risk_level}
                            </span>
                          </td>
                          <td className="max-w-xs truncate py-3 pr-3 font-mono text-xs text-slate-400">
                            {customer.phone_hash}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {customers.length === 0 && (
                    <p className="py-8 text-center text-sm text-slate-400">
                      No customers found for this risk level.
                    </p>
                  )}
                </div>
              </div>
            </section>

            <section className="grid gap-5 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
                <h2 className="text-lg font-semibold">Customer Detail</h2>

                {!selectedCustomer ? (
                  <p className="mt-4 text-sm text-slate-400">Select a flagged account to inspect model reasons.</p>
                ) : (
                  <div className="mt-5 space-y-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm text-slate-400">Customer ID</p>
                        <p className="text-xl font-bold">{selectedCustomer.customer_id}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-slate-400">Risk Score</p>
                        <p className="text-3xl font-bold text-cyan-300">{selectedCustomer.risk_score}</p>
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 text-sm font-medium text-slate-300">Top Reasons</p>
                      <div className="space-y-2">
                        {(selectedCustomer.reasons || []).map((reason, index) => (
                          <div key={index} className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300">
                            {reason}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      {Object.entries(selectedCustomer.features || {}).map(([key, value]) => (
                        <div key={key} className="rounded-lg bg-slate-950 p-3">
                          <p className="text-xs text-slate-500">{key}</p>
                          <p className="mt-1 font-semibold text-slate-200">{Number(value).toFixed(3)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
                <h2 className="text-lg font-semibold">Linked Accounts</h2>

                {!linkedAccounts ? (
                  <p className="mt-4 text-sm text-slate-400">
                    Select a customer to reveal accounts sharing the same hashed phone number.
                  </p>
                ) : (
                  <div className="mt-5 space-y-4">
                    <div className="rounded-lg border border-cyan-900 bg-cyan-950/40 p-4">
                      <p className="text-sm text-cyan-200">Aggregate Risk Score</p>
                      <p className="mt-1 text-3xl font-bold text-cyan-300">
                        {Number(linkedAccounts.aggregate_risk_score || 0).toFixed(0)}
                      </p>
                      <p className="mt-2 break-all font-mono text-xs text-slate-400">
                        {linkedAccounts.phone_hash}
                      </p>
                    </div>

                    <div className="space-y-2">
                      {(linkedAccounts.linked_accounts || []).map((account) => (
                        <div key={account.customer_id} className="flex items-center justify-between rounded-lg bg-slate-950 px-3 py-3">
                          <div>
                            <p className="font-medium">{account.customer_id}</p>
                            <p className="text-xs text-slate-500">{account.phone_number}</p>
                          </div>
                          <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${riskBadgeStyles(account.risk_level)}`}>
                            {account.risk_score} / {account.risk_level}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
            <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
  <h2 className="text-lg font-semibold">
    {t('policy_recommendations', 'AI Policy Recommendations')}
  </h2>

  {!selectedCustomer ? (
    <p className="mt-4 text-sm text-slate-400">
      Select a flagged account to generate policy recommendations.
    </p>
  ) : recommendationsLoading ? (
    <p className="mt-4 text-sm text-slate-400">Generating recommendations...</p>
  ) : !recommendations?.recommendations?.length ? (
    <p className="mt-4 text-sm text-slate-400">No recommendations loaded.</p>
  ) : (
    <div className="mt-5 grid gap-3 md:grid-cols-2">
      {recommendations.recommendations.map((item, index) => (
        <div key={index} className="rounded-lg border border-slate-800 bg-slate-950 p-4">
          <p className="font-semibold text-slate-100">{item.title}</p>
          <p className="mt-1 text-sm text-cyan-300">{item.action}</p>
          <p className="mt-3 text-sm text-slate-400">{item.reason}</p>
          <p className="mt-2 text-xs text-slate-500">Confidence: {item.confidence}%</p>
        </div>
      ))}
    </div>
  )}
</section>
          </>
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value, tone = 'slate' }) {
  const toneMap = {
    red: 'text-red-300',
    amber: 'text-amber-300',
    emerald: 'text-emerald-300',
    cyan: 'text-cyan-300',
    slate: 'text-slate-100',
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-sm text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${toneMap[tone]}`}>{value}</p>
    </div>
  );
}
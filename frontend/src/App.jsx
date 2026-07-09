import { useState, useEffect } from 'react';

const API_BASE = 'http://localhost:8000';

const initialForm = {
  customer_id: '',
  phone_number: '',
  return_rate: '',
  refund_frequency: '',
  high_value_return_ratio: '',
  version_diversity: '',
  category_diversity: '',
  avg_transaction_value: '',
};

const numericFields = [
  'return_rate',
  'refund_frequency',
  'high_value_return_ratio',
  'version_diversity',
  'category_diversity',
  'avg_transaction_value',
];

function riskBadgeStyles(level) {
  switch (level) {
    case 'High':
      return 'bg-red-100 text-red-700 border border-red-300';
    case 'Medium':
      return 'bg-amber-100 text-amber-700 border border-amber-300';
    case 'Low':
    default:
      return 'bg-emerald-100 text-emerald-700 border border-emerald-300';
  }
}

export default function App() {
  const [form, setForm] = useState(initialForm);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'timestamp', direction: 'desc' });

  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API_BASE}/history`);
      if (!res.ok) throw new Error('Failed to fetch history');
      const data = await res.json();
      setHistory(data);
    } catch (err) {
      console.error(err);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setResult(null);

    // basic validation
    if (!form.customer_id.trim() || !form.phone_number.trim()) {
      setError('Customer ID and phone number are required.');
      return;
    }
    for (const field of numericFields) {
      if (form[field] === '' || isNaN(Number(form[field]))) {
        setError(`"${field}" must be a valid number.`);
        return;
      }
    }

    const payload = {
      customer_id: form.customer_id.trim(),
      phone_number: form.phone_number.trim(),
      return_rate: parseFloat(form.return_rate),
      refund_frequency: parseFloat(form.refund_frequency),
      high_value_return_ratio: parseFloat(form.high_value_return_ratio),
      version_diversity: parseInt(form.version_diversity, 10),
      category_diversity: parseInt(form.category_diversity, 10),
      avg_transaction_value: parseFloat(form.avg_transaction_value),
    };

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.detail || `Request failed (${res.status})`);
      }
      const data = await res.json();
      setResult(data);
      fetchHistory(); // refresh table after new prediction
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  const sortedHistory = [...history].sort((a, b) => {
    const { key, direction } = sortConfig;
    let aVal = a[key];
    let bVal = b[key];
    if (key === 'timestamp') {
      aVal = new Date(aVal).getTime();
      bVal = new Date(bVal).getTime();
    }
    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();

    if (aVal < bVal) return direction === 'asc' ? -1 : 1;
    if (aVal > bVal) return direction === 'asc' ? 1 : -1;
    return 0;
  });

  const columns = [
    { key: 'timestamp', label: 'Timestamp' },
    { key: 'customer_id', label: 'Customer ID' },
    { key: 'risk_score', label: 'Score' },
    { key: 'risk_level', label: 'Risk Level' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-8">
        <header>
          <h1 className="text-2xl font-bold text-slate-800">Return Fraud Risk Detector</h1>
          <p className="text-slate-500 text-sm mt-1">
            Enter customer behavior metrics to get a real-time risk score.
          </p>
        </header>

        {/* Prediction Form */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Customer ID</label>
              <input
                type="text"
                name="customer_id"
                value={form.customer_id}
                onChange={handleChange}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="CUST1001"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Phone Number</label>
              <input
                type="text"
                name="phone_number"
                value={form.phone_number}
                onChange={handleChange}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="9876543210"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Return Rate</label>
              <input
                type="number" step="any" name="return_rate"
                value={form.return_rate} onChange={handleChange}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="0.35"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Refund Frequency</label>
              <input
                type="number" step="any" name="refund_frequency"
                value={form.refund_frequency} onChange={handleChange}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="4"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">High Value Return Ratio</label>
              <input
                type="number" step="any" name="high_value_return_ratio"
                value={form.high_value_return_ratio} onChange={handleChange}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="0.6"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Version Diversity</label>
              <input
                type="number" step="1" name="version_diversity"
                value={form.version_diversity} onChange={handleChange}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="3"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Category Diversity</label>
              <input
                type="number" step="1" name="category_diversity"
                value={form.category_diversity} onChange={handleChange}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="5"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Avg Transaction Value</label>
              <input
                type="number" step="any" name="avg_transaction_value"
                value={form.avg_transaction_value} onChange={handleChange}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="2500"
              />
            </div>

            <div className="sm:col-span-2 flex items-center gap-3 mt-2">
              <button
                type="submit"
                disabled={loading}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
              >
                {loading ? 'Scoring...' : 'Predict Risk'}
              </button>
              {error && <span className="text-sm text-red-600">{error}</span>}
            </div>
          </form>
        </div>

        {/* Result */}
        {result && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-sm text-slate-500">Customer</p>
                <p className="text-lg font-semibold text-slate-800">{result.customer_id}</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-sm text-slate-500">Risk Score</p>
                  <p className="text-2xl font-bold text-slate-800">{result.risk_score}</p>
                </div>
                <span className={`px-3 py-1.5 rounded-full text-sm font-semibold ${riskBadgeStyles(result.risk_level)}`}>
                  {result.risk_level}
                </span>
              </div>
            </div>
            {result.reasons?.length > 0 && (
              <ul className="mt-4 space-y-1 list-disc list-inside text-sm text-slate-600">
                {result.reasons.map((reason, i) => (
                  <li key={i}>{reason}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* History Table */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-800">Prediction History</h2>
            <button
              onClick={fetchHistory}
              className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
            >
              Refresh
            </button>
          </div>

          {historyLoading ? (
            <p className="text-sm text-slate-500">Loading...</p>
          ) : sortedHistory.length === 0 ? (
            <p className="text-sm text-slate-500">No predictions yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    {columns.map((col) => (
                      <th
                        key={col.key}
                        onClick={() => handleSort(col.key)}
                        className="text-left py-2 px-3 text-slate-500 font-medium cursor-pointer select-none hover:text-slate-700"
                      >
                        {col.label}
                        {sortConfig.key === col.key && (
                          <span className="ml-1">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedHistory.map((row, i) => (
                    <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2 px-3 text-slate-600">
                        {new Date(row.timestamp).toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-slate-700 font-medium">{row.customer_id}</td>
                      <td className="py-2 px-3 text-slate-700">{row.risk_score}</td>
                      <td className="py-2 px-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${riskBadgeStyles(row.risk_level)}`}>
                          {row.risk_level}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
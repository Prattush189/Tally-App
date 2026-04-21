export const fmt = (n) => {
  if (n == null) return '—';
  if (n >= 10000000) return '₹' + (n / 10000000).toFixed(2) + ' Cr';
  if (n >= 100000) return '₹' + (n / 100000).toFixed(2) + ' L';
  if (n >= 1000) return '₹' + (n / 1000).toFixed(1) + 'K';
  return '₹' + n;
};

export const fmtCompact = (n) => {
  if (n == null) return '—';
  if (n >= 1000000) return (n / 100000).toFixed(1) + 'L';
  if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
  return String(n);
};

export const RISK_COLORS = { High: '#ef4444', Medium: '#f59e0b', Low: '#22c55e' };

export const CHART_COLORS = ['#6366f1', '#8b5cf6', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#f97316', '#a78bfa'];

export const TOOLTIP_STYLE = {
  background: '#1f2937',
  border: '1px solid #374151',
  borderRadius: 12,
  color: '#fff',
  fontSize: 13,
};

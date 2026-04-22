// Small 3-button toggle for switching time series between monthly, quarterly,
// and yearly aggregation. Used on Overview + RevenueMetrics.
//
// State is hoisted to the parent so the chart re-renders when value changes.
// Defaults to 'month' so existing layouts keep their current granularity.

export const GRANULARITY_OPTIONS = [
  { value: 'month', label: 'Monthly' },
  { value: 'quarter', label: 'Quarterly' },
  { value: 'year', label: 'Yearly' },
];

export default function TimeGranularityToggle({ value, onChange, size = 'sm' }) {
  const cls = size === 'xs' ? 'text-[10px] py-1 px-2' : 'text-xs py-1.5 px-3';
  return (
    <div className="inline-flex items-center gap-1 bg-gray-900/60 rounded-lg p-0.5">
      {GRANULARITY_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`${cls} rounded-md font-medium transition-colors ${
            value === opt.value
              ? 'bg-indigo-600 text-white'
              : 'text-gray-400 hover:text-white hover:bg-gray-800/60'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// Bucket a monthly-series array into quarterly or yearly. Input is expected
// to be [{ month: 'Jan 26', revenue: 1000, ... }, ...] — we keep every
// numeric field summed and use the last period's label as the bucket label.
// Non-numeric fields are dropped (e.g. month name). Returns the original
// array untouched when granularity === 'month'.
export function aggregateSeries(series, granularity) {
  if (!Array.isArray(series) || !series.length) return [];
  if (granularity === 'month') return series;

  const groupSize = granularity === 'quarter' ? 3 : 12;
  const buckets = [];
  for (let i = 0; i < series.length; i += groupSize) {
    const slice = series.slice(i, i + groupSize);
    if (!slice.length) break;
    const numericKeys = Object.keys(slice[0]).filter(
      (k) => typeof slice[0][k] === 'number',
    );
    const bucket = { label: slice[slice.length - 1].month || slice[slice.length - 1].label || `P${buckets.length + 1}` };
    for (const key of numericKeys) {
      bucket[key] = slice.reduce((acc, row) => acc + (row[key] || 0), 0);
    }
    // Average percentage-ish fields (NRR, GRR) rather than sum — sums of
    // percentages would be meaningless.
    for (const key of ['nrr', 'grr', 'retention']) {
      if (numericKeys.includes(key)) {
        bucket[key] = Math.round(bucket[key] / slice.length);
      }
    }
    bucket.month = bucket.label; // keep the same shape as monthly series
    buckets.push(bucket);
  }
  return buckets;
}

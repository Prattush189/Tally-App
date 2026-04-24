// Financial-year presets for Tally syncs. Tally expects dates in YYYYMMDD format
// for SVFROMDATE / SVTODATE. Indian FY runs April 1 → March 31 of the next year.

export function tallyDate(d) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

export function financialYearRange(startYear) {
  const from = new Date(startYear, 3, 1);        // April 1 YYYY
  const to = new Date(startYear + 1, 2, 31);     // March 31 YYYY+1
  return {
    label: `FY ${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`,
    fromDate: tallyDate(from),
    toDate: tallyDate(to),
  };
}

export function availableRanges() {
  const now = new Date();
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return [
    // `allData: true` tells the edge function to skip its 90-day voucher
    // fallback — otherwise empty fromDate/toDate silently caps history at
    // the last 90 days, which leaves every churn/DSO/aging metric blank.
    { key: 'all', label: 'All data', fromDate: '', toDate: '', allData: true },
    financialYearRange(fyStart),
    financialYearRange(fyStart - 1),
    financialYearRange(fyStart - 2),
  ];
}

export function rangeByKey(key) {
  return availableRanges().find(r => r.label === key || r.key === key) || availableRanges()[0];
}

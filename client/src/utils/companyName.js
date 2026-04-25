// Canonical company-name + financial-year helpers.
//
// TallyPrime conventionally creates one "company" per financial year for
// the same business — e.g. the user's UNITED AGENCIES DISTRIBUTORS LLP
// shows up as both:
//   "UNITED AGENCIES DISTRIBUTORS LLP - (from 1-Apr-25)"
//   "UNITED AGENCIES DISTRIBUTORS LLP - (from 1-Apr-26)"
// The trailing " - (from D-Mon-YY)" is Tally's books-from indicator and
// is the only thing distinguishing them. From the user's point of view
// it's the same business; the analytics should fold every per-FY company
// into one canonical entity and stitch the data together.
//
// canonicalCompanyName strips that suffix; extractFyFromName parses the
// year so the sync can scope each FY's query to its own period (the
// query is otherwise unbounded — Tally returns whatever is "loaded",
// which on a fresh open of an FY company spans well past 150 MB on the
// Edge Function isolate and OOMs the Sales Register pull).

const SUFFIX_RE = /\s*[-–—]\s*\(from\s+(\d{1,2})-([A-Za-z]{3,9})-(\d{2,4})\)\s*$/i;

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export function canonicalCompanyName(rawName) {
  if (!rawName || typeof rawName !== 'string') return rawName || '';
  return rawName.replace(SUFFIX_RE, '').trim();
}

// Extract the books-from date from "(from D-Mon-YY)". Returns null when
// no suffix is present, or the date if the suffix matches Tally's shape.
// Useful both as a sort key (most-recent FY first) and as the lower
// bound of the implicit period filter we send to Tally.
export function extractFyFromName(rawName) {
  if (!rawName || typeof rawName !== 'string') return null;
  const m = SUFFIX_RE.exec(rawName);
  if (!m) return null;
  const day = Number(m[1]);
  const monthName = m[2].slice(0, 3).toLowerCase();
  const month = MONTHS[monthName];
  if (!month) return null;
  let year = Number(m[3]);
  // Two-digit years → assume 21st century. Indian distributors that have
  // been on Tally Prime since 2018-ish all fall in 20xx; a truly 19xx
  // file would be an edge case worth surfacing as an error rather than
  // misinterpreting.
  if (year < 100) year += 2000;
  // Normalise to the FY's start (Apr 1) and end (Mar 31 the following
  // year). Indian Income Tax / GST accounting periods always run Apr-Mar
  // regardless of the books-from day in the suffix; the day/month encode
  // when the COMPANY FILE began (could be mid-FY for a freshly-onboarded
  // tenant), but the FY itself is the standard envelope.
  const fyStartYear = month >= 4 ? year : year - 1;
  const fyEndYear = fyStartYear + 1;
  return {
    fyStartYear,
    fyEndYear,
    booksFromYear: year,
    booksFromMonth: month,
    booksFromDay: day,
    fromDate: `${fyStartYear}0401`,
    toDate: `${fyEndYear}0331`,
    label: `FY${String(fyStartYear).slice(2)}-${String(fyEndYear).slice(2)}`,
  };
}

// Group an array of raw Tally company names by their canonical name.
// Returns [{ canonical, members: [{ raw, fy }] }] sorted by canonical
// name; members within each canonical are sorted most-recent FY first
// so the active picker defaults to the latest data.
export function groupCompaniesByCanonical(rawNames) {
  if (!Array.isArray(rawNames)) return [];
  const buckets = new Map();
  for (const raw of rawNames) {
    if (!raw || typeof raw !== 'string') continue;
    const canonical = canonicalCompanyName(raw);
    const fy = extractFyFromName(raw);
    if (!buckets.has(canonical)) buckets.set(canonical, []);
    buckets.get(canonical).push({ raw, fy });
  }
  return Array.from(buckets.entries())
    .map(([canonical, members]) => ({
      canonical,
      members: members.sort((a, b) => (b.fy?.fyStartYear || 0) - (a.fy?.fyStartYear || 0)),
    }))
    .sort((a, b) => a.canonical.localeCompare(b.canonical));
}

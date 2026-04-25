import { useRef, useState } from 'react';
import { Upload, CheckCircle2, AlertTriangle, FileSpreadsheet } from 'lucide-react';
import { ingestManualVouchers } from '../../lib/tallyClient';

// Manual Day Book CSV upload — escape hatch for installs whose Tally
// crashes on every voucher iterator (Day Book, Sales Register, custom
// Voucher COLLECTION all bomb with c0000005). User exports Day Book to
// Excel from inside Tally (Display More → Day Book → Ctrl+E → CSV), drops
// the file here, and the parsed voucher headers land in the snapshot
// under the `manualVouchers` key.
//
// Tally's Day Book CSV uses a quirky shape:
//   - first 3-5 rows are titles ("Day Book", "1-Apr-2025 to 31-Mar-2026", blank)
//   - column header row holds: Date, Particulars, Vch Type, Vch No., Debit, Credit
//   - rows are then `Date | Particulars | Vch Type | Vch No. | Debit | Credit`
//
// We detect the header row by scanning for "Vch Type" + "Vch No" tokens, then
// map every subsequent non-empty row to the voucher shape the transformer
// expects.

const MONTH_MAP = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

// Tally exports dates like "1-Apr-2025" or "01/04/2025" or "2025-04-01".
// Normalize all of those to YYYYMMDD which the transformer's parseTallyDate
// already accepts directly.
function normalizeDate(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (!s) return '';
  // Already YYYYMMDD?
  if (/^\d{8}$/.test(s)) return s;
  // ISO-ish 2025-04-01.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}${iso[2]}${iso[3]}`;
  // 1-Apr-2025 / 01-Apr-2025 / 1-Apr-25.
  const tally = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/.exec(s);
  if (tally) {
    const day = tally[1].padStart(2, '0');
    const mon = MONTH_MAP[tally[2].toLowerCase()];
    let year = tally[3];
    if (year.length === 2) year = `20${year}`;
    if (mon) return `${year}${mon}${day}`;
  }
  // 01/04/2025 (DD/MM/YYYY — Tally's locale default).
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (slash) {
    const day = slash[1].padStart(2, '0');
    const mon = slash[2].padStart(2, '0');
    let year = slash[3];
    if (year.length === 2) year = `20${year}`;
    return `${year}${mon}${day}`;
  }
  // Fall back to whatever Date can parse.
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${dd}`;
  }
  return s;
}

// Tally writes amounts as "1,23,456.00 Cr" or "1,23,456.00 Dr" or just numeric.
// Strip commas, lakh separators, currency suffix; return positive number.
function parseAmount(raw) {
  if (raw == null) return 0;
  const s = String(raw).replace(/[,₹\s]/g, '').replace(/(Cr|Dr)$/i, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.abs(n);
}

// Minimal RFC 4180 CSV row splitter: respects double-quoted fields,
// handles "" as escaped quote, and one row per call. Tally's CSV export
// uses quotes around any field containing a comma (typical for party
// names with "M/s, Pvt Ltd" etc).
function splitCsvRow(row) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (inQuotes) {
      if (ch === '"' && row[i + 1] === '"') { cur += '"'; i += 1; }
      else if (ch === '"') { inQuotes = false; }
      else { cur += ch; }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function parseTallyDayBookCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { vouchers: [], error: 'CSV is empty.' };
  // Find the header row by scanning the first ~25 lines.
  let headerIdx = -1;
  let headerCols = [];
  for (let i = 0; i < Math.min(lines.length, 25); i++) {
    const cols = splitCsvRow(lines[i]).map((c) => c.toLowerCase());
    const hasType = cols.some((c) => c.includes('vch type') || c === 'voucher type' || c.includes('type'));
    const hasNum = cols.some((c) => c.includes('vch no') || c === 'voucher no' || c.includes('no.'));
    const hasDate = cols.some((c) => c === 'date' || c.includes('vch date'));
    if (hasType && hasNum && hasDate) { headerIdx = i; headerCols = cols; break; }
  }
  if (headerIdx < 0) {
    return {
      vouchers: [],
      error: 'Could not find a header row with Date, Vch Type, and Vch No. columns. Re-export from Tally (Display More → Day Book → Ctrl+E → CSV) and try again.',
    };
  }
  // Map column-index → field. Tally headers are reasonably stable; cover
  // the common variants.
  const idx = (predicates) => {
    for (let i = 0; i < headerCols.length; i++) {
      if (predicates.some((p) => p(headerCols[i]))) return i;
    }
    return -1;
  };
  const colDate = idx([(c) => c === 'date', (c) => c.includes('vch date')]);
  const colParty = idx([(c) => c === 'particulars', (c) => c.includes('party')]);
  const colType = idx([(c) => c === 'vch type', (c) => c === 'voucher type', (c) => c === 'type']);
  const colNum = idx([(c) => c === 'vch no.', (c) => c === 'vch no', (c) => c === 'voucher no', (c) => c.includes('no.')]);
  const colDebit = idx([(c) => c === 'debit', (c) => c === 'debit amount', (c) => c.includes('debit')]);
  const colCredit = idx([(c) => c === 'credit', (c) => c === 'credit amount', (c) => c.includes('credit')]);
  const colAmount = idx([(c) => c === 'amount', (c) => c === 'value']);

  const vouchers = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = splitCsvRow(lines[i]);
    if (!cols.length) continue;
    const date = normalizeDate(colDate >= 0 ? cols[colDate] : '');
    if (!date || !/^\d{8}$/.test(date)) continue; // skip subtotal / blank rows
    const type = (colType >= 0 ? cols[colType] : '').trim();
    const number = (colNum >= 0 ? cols[colNum] : '').trim();
    const party = (colParty >= 0 ? cols[colParty] : '').trim();
    let amount = 0;
    if (colAmount >= 0) amount = parseAmount(cols[colAmount]);
    else {
      const dr = parseAmount(colDebit >= 0 ? cols[colDebit] : '');
      const cr = parseAmount(colCredit >= 0 ? cols[colCredit] : '');
      amount = Math.max(dr, cr);
    }
    if (!type && !party) continue;
    vouchers.push({
      DATE: date,
      VOUCHERNUMBER: number,
      VOUCHERTYPENAME: type || 'Sales',
      PARTYLEDGERNAME: party,
      AMOUNT: String(amount),
    });
  }
  return { vouchers, error: vouchers.length ? null : 'No voucher rows found below the header — was the export empty?' };
}

export default function ManualVoucherUpload({ onUploaded }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [parseInfo, setParseInfo] = useState(null);

  const handleFile = async (file) => {
    if (!file) return;
    setBusy(true);
    setResult(null);
    setParseInfo(null);
    try {
      const text = await file.text();
      const { vouchers, error: parseErr } = parseTallyDayBookCsv(text);
      if (parseErr) {
        setResult({ success: false, error: parseErr });
        return;
      }
      setParseInfo({ count: vouchers.length, file: file.name });
      const r = await ingestManualVouchers(vouchers);
      setResult(r);
      if (r.success) onUploaded?.(r);
    } catch (err) {
      setResult({ success: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass-card p-5 space-y-3">
      <div className="flex items-start gap-3">
        <FileSpreadsheet size={20} className="text-indigo-300 mt-0.5 flex-shrink-0" />
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-white">Manual Day Book upload (CSV)</h3>
          <p className="text-xs text-gray-400 leading-relaxed">
            Voucher fetch over XML keeps crashing your Tally with a c0000005 — open <span className="text-gray-300">Display More → Day Book</span> in Tally, press <span className="text-gray-300">Ctrl+E</span>, choose <span className="text-gray-300">CSV</span>, and drop the file here. Headers (Date, Vch Type, Vch No., Particulars, Debit/Credit) feed straight into revenue, aging, DSO and trend tiles.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-wait text-white text-sm font-semibold px-4 py-2 rounded-lg transition-all"
        >
          <Upload size={14} />
          {busy ? 'Uploading…' : 'Choose CSV file'}
        </button>
        {parseInfo && (
          <span className="text-xs text-gray-400">
            Parsed <span className="text-gray-200">{parseInfo.count.toLocaleString()}</span> voucher rows from <span className="text-gray-200">{parseInfo.file}</span>
          </span>
        )}
      </div>

      {result && result.success && (
        <div className="flex items-start gap-2 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
          <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />
          <span>
            {result.count?.toLocaleString() || parseInfo?.count?.toLocaleString() || '0'} vouchers ingested for <span className="font-semibold">{result.company}</span>. Refresh the dashboards to see revenue / aging / DSO populate.
          </span>
        </div>
      )}
      {result && !result.success && (
        <div className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{result.error || 'Upload failed.'}</span>
        </div>
      )}
    </div>
  );
}

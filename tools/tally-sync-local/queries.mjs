// Tally XML query builders. Mirror of supabase/functions/tally/index.ts —
// when you change one, change both. All queries now use built-in Tally
// <TYPE>Data</TYPE> report IDs instead of custom TDL collections. Built-in
// reports are pre-compiled inside Tally, so they (a) return faster, (b)
// send a tiny XML request body, and (c) don't block on the tunnel's idle
// timer the way custom TDL compile does.

export function companyFilter(company) {
  return company ? `<SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>` : '';
}

function dateFilter(cfg) {
  const parts = [];
  if (cfg.fromDate) parts.push(`<SVFROMDATE Type="Date">${cfg.fromDate}</SVFROMDATE>`);
  if (cfg.toDate) parts.push(`<SVTODATE Type="Date">${cfg.toDate}</SVTODATE>`);
  return parts.join('');
}

// Voucher queries default to the last 90 days when no range is supplied —
// pulling all-time history blows past the tunnel's payload ceiling.
function voucherDateFilter(cfg) {
  if (cfg.fromDate || cfg.toDate) return dateFilter(cfg);
  const d = new Date();
  const to = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  d.setDate(d.getDate() - 90);
  const from = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `<SVFROMDATE Type="Date">${from}</SVFROMDATE><SVTODATE Type="Date">${to}</SVTODATE>`;
}

function reportRequest(reportId, cfg) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>${reportId}</ID></HEADER>
  <BODY><DESC><STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    ${companyFilter(cfg.company)}
    ${cfg.vouchers ? voucherDateFilter(cfg) : dateFilter(cfg)}
  </STATICVARIABLES></DESC></BODY>
</ENVELOPE>`;
}

export function sundryDebtorsRequest(cfg) {
  return reportRequest('List of Accounts', cfg);
}

export function salesVouchersRequest(cfg) {
  return reportRequest('Day Book', { ...cfg, vouchers: true });
}

export function receiptVouchersRequest(cfg) {
  return reportRequest('Day Book', { ...cfg, vouchers: true });
}

export function stockItemsRequest(cfg) {
  return reportRequest('Stock Summary', { company: cfg.company });
}

export function stockGroupsRequest(cfg) {
  return reportRequest('List of Stock Groups', { company: cfg.company });
}

export const XML_ARRAY_NODES = new Set([
  'LEDGER', 'VOUCHER', 'STOCKITEM', 'STOCKGROUP', 'BILL', 'BODY', 'COLLECTION',
  'ALLINVENTORYENTRIES.LIST', 'INVENTORYENTRIES.LIST',
  'ALLLEDGERENTRIES.LIST', 'LEDGERENTRIES.LIST',
  'BILLALLOCATIONS.LIST', 'BATCHALLOCATIONS.LIST',
]);

export function countNode(parsed, node) {
  let count = 0;
  const walk = (v) => {
    if (!v) return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v !== 'object') return;
    for (const [k, val] of Object.entries(v)) {
      if (k.toUpperCase() === node) {
        count += Array.isArray(val) ? val.length : 1;
      } else {
        walk(val);
      }
    }
  };
  walk(parsed);
  return count;
}

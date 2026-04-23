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
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>B2BIntelLedgers</ID></HEADER>
  <BODY><DESC>
    <STATICVARIABLES>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      ${companyFilter(cfg.company)}
      ${dateFilter(cfg)}
    </STATICVARIABLES>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="B2BIntelLedgers" ISMODIFY="No">
        <TYPE>Ledger</TYPE>
        <NATIVEMETHOD>Name</NATIVEMETHOD>
        <NATIVEMETHOD>Parent</NATIVEMETHOD>
        <NATIVEMETHOD>ClosingBalance</NATIVEMETHOD>
        <NATIVEMETHOD>OpeningBalance</NATIVEMETHOD>
        <NATIVEMETHOD>CreditLimit</NATIVEMETHOD>
        <NATIVEMETHOD>CreditPeriod</NATIVEMETHOD>
        <NATIVEMETHOD>PartyGSTIN</NATIVEMETHOD>
        <NATIVEMETHOD>LedStateName</NATIVEMETHOD>
        <NATIVEMETHOD>Address</NATIVEMETHOD>
      </COLLECTION>
    </TDLMESSAGE></TDL>
  </DESC></BODY>
</ENVELOPE>`;
}

// Sales Register / Receipt Register return only the matching voucher type,
// not every voucher type in the window like 'Day Book' did. Much smaller
// payloads, and no back-to-back duplicate fetches of the same huge report.
export function salesVouchersRequest(cfg) {
  return reportRequest('Sales Register', { ...cfg, vouchers: true });
}

export function receiptVouchersRequest(cfg) {
  return reportRequest('Receipt Register', { ...cfg, vouchers: true });
}

// Stock items / groups: custom COLLECTION. Built-in Stock Summary returns
// hierarchical summary rows, not flat STOCKITEM[] — observed returning 1
// row instead of 803. Custom collection gets the flat array we need.
export function stockItemsRequest(cfg) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>B2BIntelStockItems</ID></HEADER>
  <BODY><DESC>
    <STATICVARIABLES>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      ${companyFilter(cfg.company)}
    </STATICVARIABLES>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="B2BIntelStockItems" ISMODIFY="No">
        <TYPE>StockItem</TYPE>
        <NATIVEMETHOD>Name</NATIVEMETHOD>
        <NATIVEMETHOD>Parent</NATIVEMETHOD>
        <NATIVEMETHOD>Category</NATIVEMETHOD>
        <NATIVEMETHOD>BaseUnits</NATIVEMETHOD>
        <NATIVEMETHOD>OpeningBalance</NATIVEMETHOD>
        <NATIVEMETHOD>ClosingBalance</NATIVEMETHOD>
        <NATIVEMETHOD>ClosingRate</NATIVEMETHOD>
        <NATIVEMETHOD>ClosingValue</NATIVEMETHOD>
        <NATIVEMETHOD>HSNCode</NATIVEMETHOD>
        <NATIVEMETHOD>GSTApplicable</NATIVEMETHOD>
      </COLLECTION>
    </TDLMESSAGE></TDL>
  </DESC></BODY>
</ENVELOPE>`;
}

export function stockGroupsRequest(cfg) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>B2BIntelStockGroups</ID></HEADER>
  <BODY><DESC>
    <STATICVARIABLES>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      ${companyFilter(cfg.company)}
    </STATICVARIABLES>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="B2BIntelStockGroups" ISMODIFY="No">
        <TYPE>StockGroup</TYPE>
        <NATIVEMETHOD>Name</NATIVEMETHOD>
        <NATIVEMETHOD>Parent</NATIVEMETHOD>
      </COLLECTION>
    </TDLMESSAGE></TDL>
  </DESC></BODY>
</ENVELOPE>`;
}

export function accountingGroupsRequest(cfg) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>B2BIntelGroups</ID></HEADER>
  <BODY><DESC>
    <STATICVARIABLES>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      ${companyFilter(cfg.company)}
    </STATICVARIABLES>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="B2BIntelGroups" ISMODIFY="No">
        <TYPE>Group</TYPE>
        <NATIVEMETHOD>Name</NATIVEMETHOD>
        <NATIVEMETHOD>Parent</NATIVEMETHOD>
      </COLLECTION>
    </TDLMESSAGE></TDL>
  </DESC></BODY>
</ENVELOPE>`;
}

export const XML_ARRAY_NODES = new Set([
  'LEDGER', 'VOUCHER', 'STOCKITEM', 'STOCKGROUP', 'GROUP', 'BILL', 'BODY', 'COLLECTION',
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

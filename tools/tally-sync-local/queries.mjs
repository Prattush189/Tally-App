// Tally XML collection definitions. Duplicated from
// supabase/functions/tally/index.ts because Deno and Node import semantics
// don't overlap — one source of truth lives in the edge function, and this
// file is a straight mirror. When you change one, change both.

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

export function sundryDebtorsRequest(cfg) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>B2BIntelDebtors</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        ${companyFilter(cfg.company)}
        ${dateFilter(cfg)}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="B2BIntelDebtors" ISMODIFY="No">
            <TYPE>Ledger</TYPE>
            <NATIVEMETHOD>Name</NATIVEMETHOD>
            <NATIVEMETHOD>Parent</NATIVEMETHOD>
            <NATIVEMETHOD>OpeningBalance</NATIVEMETHOD>
            <NATIVEMETHOD>ClosingBalance</NATIVEMETHOD>
            <NATIVEMETHOD>PartyGSTIN</NATIVEMETHOD>
            <NATIVEMETHOD>LedStateName</NATIVEMETHOD>
            <NATIVEMETHOD>CreditPeriod</NATIVEMETHOD>
            <NATIVEMETHOD>CreditLimit</NATIVEMETHOD>
            <NATIVEMETHOD>Address</NATIVEMETHOD>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

export function salesVouchersRequest(cfg) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>B2BIntelSales</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        ${companyFilter(cfg.company)}
        ${voucherDateFilter(cfg)}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="B2BIntelSales" ISMODIFY="No">
            <TYPE>Voucher</TYPE>
            <FILTERS>IsSalesVoucher</FILTERS>
            <NATIVEMETHOD>Date</NATIVEMETHOD>
            <NATIVEMETHOD>VoucherNumber</NATIVEMETHOD>
            <NATIVEMETHOD>VoucherTypeName</NATIVEMETHOD>
            <NATIVEMETHOD>PartyLedgerName</NATIVEMETHOD>
            <NATIVEMETHOD>Amount</NATIVEMETHOD>
            <NATIVEMETHOD>Reference</NATIVEMETHOD>
          </COLLECTION>
        </TDLMESSAGE>
        <SYSTEM TYPE="Formulae" NAME="IsSalesVoucher">$$IsSales:$VoucherTypeName</SYSTEM>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

export function receiptVouchersRequest(cfg) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>B2BIntelReceipts</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        ${companyFilter(cfg.company)}
        ${voucherDateFilter(cfg)}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="B2BIntelReceipts" ISMODIFY="No">
            <TYPE>Voucher</TYPE>
            <FILTERS>IsReceiptVoucher</FILTERS>
            <NATIVEMETHOD>Date</NATIVEMETHOD>
            <NATIVEMETHOD>VoucherNumber</NATIVEMETHOD>
            <NATIVEMETHOD>VoucherTypeName</NATIVEMETHOD>
            <NATIVEMETHOD>PartyLedgerName</NATIVEMETHOD>
            <NATIVEMETHOD>Amount</NATIVEMETHOD>
            <NATIVEMETHOD>Reference</NATIVEMETHOD>
          </COLLECTION>
        </TDLMESSAGE>
        <SYSTEM TYPE="Formulae" NAME="IsReceiptVoucher">$$IsReceipt:$VoucherTypeName</SYSTEM>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

export function stockItemsRequest(cfg) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>B2BIntelStockItems</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        ${companyFilter(cfg.company)}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
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
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

export function stockGroupsRequest(cfg) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>B2BIntelStockGroups</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        ${companyFilter(cfg.company)}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="B2BIntelStockGroups" ISMODIFY="No">
            <TYPE>StockGroup</TYPE>
            <NATIVEMETHOD>Name</NATIVEMETHOD>
            <NATIVEMETHOD>Parent</NATIVEMETHOD>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
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

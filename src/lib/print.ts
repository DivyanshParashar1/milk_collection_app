// ============================================================================
// Printing & PDF export via expo-print (+ expo-sharing).
//
// - printCollectionSlip: opens the OS print sheet with a 58mm-style receipt.
//   Works with any printer the phone can reach, including many Bluetooth
//   thermal printers registered with Android's print service. (A dedicated
//   ESC/POS Bluetooth driver can be added later for a specific printer model.)
// - exportReportPdf: renders HTML to a PDF file and opens the share sheet
//   (WhatsApp, email, Drive…).
// ============================================================================
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
// Stable legacy file API (supported via this subpath on SDK 57).
import { cacheDirectory, copyAsync } from 'expo-file-system/legacy';

const esc = (s: any) =>
  String(s ?? '').replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));

export type SlipData = {
  society: string;
  date: string;
  session: string;
  code: number | string;
  name: string;
  weight: number;
  fat: number;
  snf: number;
  rate: number;
  amount: number;
};

export function collectionSlipHtml(d: SlipData): string {
  const row = (a: string, b: string) =>
    `<tr><td>${esc(a)}</td><td style="text-align:right">${esc(b)}</td></tr>`;
  return `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    @page { margin: 4px; }
    body { width: 280px; font-family: monospace; color:#000; font-size:13px; }
    h2 { text-align:center; margin:2px 0; font-size:15px; }
    .muted { text-align:center; font-size:11px; margin-bottom:6px; }
    table { width:100%; border-collapse:collapse; }
    td { padding:2px 0; }
    .hr { border-top:1px dashed #000; margin:6px 0; }
    .total { font-size:16px; font-weight:bold; }
  </style></head><body>
    <h2>${esc(d.society)}</h2>
    <div class="muted">${esc(d.date)} &middot; ${esc(d.session)}</div>
    <div class="hr"></div>
    <table>
      ${row('Farmer', `${esc(d.name)} (#${esc(d.code)})`)}
      ${row('Weight (L)', d.weight.toFixed(2))}
      ${row('Fat %', d.fat.toFixed(1))}
      ${d.snf > 0 ? row('SNF %', d.snf.toFixed(1)) : ''}
      ${row('Rate /L', `Rs ${d.rate.toFixed(2)}`)}
    </table>
    <div class="hr"></div>
    <table><tr><td class="total">TOTAL</td><td class="total" style="text-align:right">Rs ${d.amount.toFixed(2)}</td></tr></table>
    <div class="hr"></div>
    <div class="muted">Thank you</div>
  </body></html>`;
}

export type ReportData = {
  society: string;
  periodLabel: string;
  litres: number;
  amount: number;
  avgFat: number;
  count: number;
  amLitres: number;
  pmLitres: number;
  cash: number;
  upi: number;
  farmers: { membercode: number; name?: string; litres: number; amount: number }[];
};

export function reportHtml(d: ReportData): string {
  const rows = d.farmers
    .map(
      (f) =>
        `<tr><td>${esc(f.membercode)}</td><td>${esc(f.name ?? '-')}</td>
         <td style="text-align:right">${f.litres.toFixed(1)}</td>
         <td style="text-align:right">${f.amount.toFixed(0)}</td></tr>`
    )
    .join('');
  return `<html><head><meta charset="utf-8">
  <style>
    body { font-family: -apple-system, Roboto, sans-serif; color:#0d1b2a; padding:16px; }
    h1 { font-size:20px; margin:0; }
    .sub { color:#67788a; margin:2px 0 14px; }
    .cards { display:flex; gap:10px; margin-bottom:16px; flex-wrap:wrap; }
    .card { flex:1; min-width:110px; background:#f3f5f7; border-radius:10px; padding:12px; text-align:center; }
    .cv { font-size:20px; font-weight:800; }
    .cl { color:#67788a; font-size:12px; }
    table { width:100%; border-collapse:collapse; font-size:13px; }
    th,td { padding:6px 8px; border-bottom:1px solid #e5e9ee; text-align:left; }
    th { background:#0d1b2a; color:#fff; }
  </style></head><body>
    <h1>${esc(d.society)}</h1>
    <div class="sub">Report &middot; ${esc(d.periodLabel)}</div>
    <div class="cards">
      <div class="card"><div class="cv">${d.litres.toFixed(1)}</div><div class="cl">Litres</div></div>
      <div class="card"><div class="cv">Rs ${d.amount.toFixed(0)}</div><div class="cl">Amount</div></div>
      <div class="card"><div class="cv">${d.avgFat.toFixed(1)}</div><div class="cl">Avg Fat %</div></div>
      <div class="card"><div class="cv">${d.count}</div><div class="cl">Entries</div></div>
    </div>
    <div class="cards">
      <div class="card"><div class="cv">${d.amLitres.toFixed(1)}</div><div class="cl">Morning L</div></div>
      <div class="card"><div class="cv">${d.pmLitres.toFixed(1)}</div><div class="cl">Evening L</div></div>
      <div class="card"><div class="cv">Rs ${d.cash.toFixed(0)}</div><div class="cl">Cash paid</div></div>
      <div class="card"><div class="cv">Rs ${d.upi.toFixed(0)}</div><div class="cl">UPI paid</div></div>
    </div>
    <table>
      <tr><th>Code</th><th>Name</th><th style="text-align:right">Litres</th><th style="text-align:right">Rs</th></tr>
      ${rows || '<tr><td colspan="4">No collections</td></tr>'}
    </table>
  </body></html>`;
}

export async function printCollectionSlip(d: SlipData): Promise<{ error?: string }> {
  try {
    await Print.printAsync({ html: collectionSlipHtml(d) });
    return {};
  } catch (e: any) {
    return { error: String(e?.message ?? e) };
  }
}

export async function exportReportPdf(d: ReportData): Promise<{ error?: string }> {
  try {
    if (!(await Sharing.isAvailableAsync())) {
      return { error: 'Sharing is not available on this device.' };
    }
    const { uri } = await Print.printToFileAsync({ html: reportHtml(d) });

    // printToFileAsync writes to a temp path the share sheet may not be allowed
    // to read. Copy it into the app's own cache dir (which IS shareable) with a
    // clean .pdf name, then share that.
    let shareUri = uri;
    if (cacheDirectory) {
      try {
        const dest = `${cacheDirectory}report-${Date.now()}.pdf`;
        await copyAsync({ from: uri, to: dest });
        shareUri = dest;
      } catch {
        shareUri = uri; // fall back to the original if the copy fails
      }
    }

    await Sharing.shareAsync(shareUri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: 'Share report',
    });
    return {};
  } catch (e: any) {
    return { error: String(e?.message ?? e) };
  }
}

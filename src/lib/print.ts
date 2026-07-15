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

// ---------- Datewise report PDF export ----------

export type DatewiseReportData = {
  society: string;
  from: string;
  to: string;
  rows: { date: string; amLitres: number; pmLitres: number; totalLitres: number; avgFat: number; amount: number; count: number }[];
  totals: { amLitres: number; pmLitres: number; totalLitres: number; avgFat: number; amount: number; count: number };
};

export function datewiseReportHtml(d: DatewiseReportData): string {
  const trs = d.rows
    .map(
      (r, i) =>
        `<tr style="background:${i % 2 === 0 ? '#f8f9fa' : '#fff'}">
          <td>${esc(r.date)}</td>
          <td style="text-align:right">${Number(r.amLitres).toFixed(1)}</td>
          <td style="text-align:right">${Number(r.pmLitres).toFixed(1)}</td>
          <td style="text-align:right;font-weight:700">${Number(r.totalLitres).toFixed(1)}</td>
          <td style="text-align:right">${Number(r.avgFat).toFixed(1)}</td>
          <td style="text-align:right;font-weight:700">Rs ${Number(r.amount).toFixed(0)}</td>
        </tr>`
    )
    .join('');
  return `<html><head><meta charset="utf-8">
  <style>
    body { font-family: -apple-system, Roboto, sans-serif; color:#0d1b2a; padding:16px; }
    h1 { font-size:20px; margin:0; }
    .sub { color:#67788a; margin:2px 0 14px; }
    .cards { display:flex; gap:10px; margin-bottom:16px; flex-wrap:wrap; }
    .card { flex:1; min-width:100px; background:#f3f5f7; border-radius:10px; padding:12px; text-align:center; }
    .cv { font-size:18px; font-weight:800; }
    .cl { color:#67788a; font-size:11px; }
    table { width:100%; border-collapse:collapse; font-size:12px; }
    th,td { padding:5px 6px; border-bottom:1px solid #e5e9ee; text-align:left; }
    th { background:#0d1b2a; color:#fff; }
    .totrow td { background:#0d1b2a; color:#fff; font-weight:800; }
  </style></head><body>
    <h1>${esc(d.society)}</h1>
    <div class="sub">Datewise Report &middot; ${esc(d.from)} → ${esc(d.to)}</div>
    <div class="cards">
      <div class="card"><div class="cv">${d.totals.totalLitres.toFixed(1)}</div><div class="cl">Total Litres</div></div>
      <div class="card"><div class="cv">Rs ${d.totals.amount.toFixed(0)}</div><div class="cl">Amount</div></div>
      <div class="card"><div class="cv">${d.totals.avgFat.toFixed(1)}%</div><div class="cl">Avg Fat</div></div>
      <div class="card"><div class="cv">${d.totals.count}</div><div class="cl">Entries</div></div>
    </div>
    <table>
      <tr><th>Date</th><th style="text-align:right">AM L</th><th style="text-align:right">PM L</th><th style="text-align:right">Total L</th><th style="text-align:right">Fat%</th><th style="text-align:right">Rs</th></tr>
      ${trs || '<tr><td colspan="6">No data</td></tr>'}
      <tr class="totrow"><td>TOTAL</td>
        <td style="text-align:right">${d.totals.amLitres.toFixed(1)}</td>
        <td style="text-align:right">${d.totals.pmLitres.toFixed(1)}</td>
        <td style="text-align:right">${d.totals.totalLitres.toFixed(1)}</td>
        <td style="text-align:right">${d.totals.avgFat.toFixed(1)}</td>
        <td style="text-align:right">Rs ${d.totals.amount.toFixed(0)}</td>
      </tr>
    </table>
  </body></html>`;
}

export async function exportDatewiseReportPdf(d: DatewiseReportData): Promise<{ error?: string }> {
  try {
    if (!(await Sharing.isAvailableAsync())) {
      return { error: 'Sharing is not available on this device.' };
    }
    const { uri } = await Print.printToFileAsync({ html: datewiseReportHtml(d) });

    let shareUri = uri;
    if (cacheDirectory) {
      try {
        const dest = `${cacheDirectory}datewise-${Date.now()}.pdf`;
        await copyAsync({ from: uri, to: dest });
        shareUri = dest;
      } catch {
        shareUri = uri;
      }
    }

    await Sharing.shareAsync(shareUri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: 'Share datewise report',
    });
    return {};
  } catch (e: any) {
    return { error: String(e?.message ?? e) };
  }
}

// ---------- Payment Report (Farmer Period Bill) PDF ----------

import type { FarmerPeriodData } from './db';

export type PaymentReportInput = {
  society: string;
  memberName: string;
  membercode: number;
  from: string;
  to: string;
  data: FarmerPeriodData;
};

function paymentReportHtml(d: PaymentReportInput): string {
  const { data } = d;

  const collRows = data.collections
    .map(
      (c, i) =>
        `<tr style="background:${i % 2 === 0 ? '#f8f9fa' : '#fff'}">
          <td>${esc(c.collect_date)}</td>
          <td>${c.session === 0 ? 'AM' : 'PM'}</td>
          <td style="text-align:right">${c.weight}</td>
          <td style="text-align:right">${c.fat}</td>
          <td style="text-align:right">${Number(c.rate).toFixed(2)}</td>
          <td style="text-align:right;font-weight:700">Rs ${Number(c.pay_price).toFixed(0)}</td>
        </tr>`
    )
    .join('');

  const ledgerRows = data.ledger
    .map(
      (l, i) =>
        `<tr style="background:${i % 2 === 0 ? '#f8f9fa' : '#fff'}">
          <td>${esc(l.entry_date)}</td>
          <td>${esc(l.kind)}</td>
          <td>${esc(l.note ?? '')}</td>
          <td style="text-align:right;font-weight:700;color:${l.kind === 'jama' ? '#1b9c66' : '#c0392b'}">${l.kind === 'jama' ? '+' : '-'}Rs ${Number(l.amount).toFixed(0)}</td>
        </tr>`
    )
    .join('');

  const payoutRows = data.payouts
    .map(
      (p, i) =>
        `<tr style="background:${i % 2 === 0 ? '#f8f9fa' : '#fff'}">
          <td>${esc((p.paid_at ?? '').slice(0, 10))}</td>
          <td>${esc(p.method)}</td>
          <td style="text-align:right;font-weight:700;color:#c0392b">-Rs ${Number(p.amount).toFixed(0)}</td>
        </tr>`
    )
    .join('');

  return `<html><head><meta charset="utf-8">
  <style>
    body{font-family:-apple-system,Roboto,sans-serif;color:#0d1b2a;padding:16px}
    h1{font-size:18px;margin:0}
    .sub{color:#67788a;margin:2px 0 14px}
    .sum{background:#f3f5f7;border-radius:10px;padding:14px;margin-bottom:16px}
    .sr{display:flex;justify-content:space-between;padding:4px 0}
    .sr .l{color:#4a5a6a}.sr .v{font-weight:800}
    .net{border-top:2px solid #0d1b2a;padding-top:8px;margin-top:8px;font-size:16px}
    .net .v{font-size:20px}
    table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px}
    th,td{padding:4px 6px;border-bottom:1px solid #e5e9ee;text-align:left}
    th{background:#0d1b2a;color:#fff}
    h3{margin:12px 0 6px;font-size:14px}
  </style></head><body>
    <h1>${esc(d.society)}</h1>
    <div class="sub">Payment Report &middot; ${esc(d.memberName)} (#${d.membercode}) &middot; ${esc(d.from)} &rarr; ${esc(d.to)}</div>
    <div class="sum">
      <div class="sr"><span class="l">Milk earnings</span><span class="v" style="color:#1b9c66">Rs ${data.totalMilk.toFixed(0)}</span></div>
      <div class="sr"><span class="l">Deductions (kapat)</span><span class="v" style="color:#c0392b">-Rs ${data.totalDeductions.toFixed(0)}</span></div>
      <div class="sr"><span class="l">Jama (credit)</span><span class="v" style="color:#1b9c66">+Rs ${data.totalJama.toFixed(0)}</span></div>
      <div class="sr"><span class="l">Udhar (debit)</span><span class="v" style="color:#c0392b">-Rs ${data.totalUdhar.toFixed(0)}</span></div>
      <div class="sr"><span class="l">Payouts paid</span><span class="v" style="color:#c0392b">-Rs ${data.totalPayouts.toFixed(0)}</span></div>
      <div class="sr net"><span class="l" style="font-weight:800">Net payable</span><span class="v" style="color:${data.netPayable >= 0 ? '#1b9c66' : '#c0392b'}">${data.netPayable >= 0 ? '' : '-'}Rs ${Math.abs(data.netPayable).toFixed(0)}</span></div>
    </div>
    <h3>Milk Collections (${data.collections.length})</h3>
    <table><tr><th>Date</th><th>Sess</th><th style="text-align:right">L</th><th style="text-align:right">Fat%</th><th style="text-align:right">Rate</th><th style="text-align:right">Rs</th></tr>${collRows || '<tr><td colspan="6">None</td></tr>'}</table>
    ${data.ledger.length ? `<h3>Ledger (${data.ledger.length})</h3><table><tr><th>Date</th><th>Type</th><th>Note</th><th style="text-align:right">Rs</th></tr>${ledgerRows}</table>` : ''}
    ${data.payouts.length ? `<h3>Payouts (${data.payouts.length})</h3><table><tr><th>Date</th><th>Method</th><th style="text-align:right">Rs</th></tr>${payoutRows}</table>` : ''}
  </body></html>`;
}

export async function exportPaymentReportPdf(d: PaymentReportInput): Promise<{ error?: string }> {
  try {
    if (!(await Sharing.isAvailableAsync())) {
      return { error: 'Sharing is not available on this device.' };
    }
    const { uri } = await Print.printToFileAsync({ html: paymentReportHtml(d) });

    let shareUri = uri;
    if (cacheDirectory) {
      try {
        const dest = `${cacheDirectory}payment-${d.membercode}-${Date.now()}.pdf`;
        await copyAsync({ from: uri, to: dest });
        shareUri = dest;
      } catch {
        shareUri = uri;
      }
    }

    await Sharing.shareAsync(shareUri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: 'Share payment report',
    });
    return {};
  } catch (e: any) {
    return { error: String(e?.message ?? e) };
  }
}

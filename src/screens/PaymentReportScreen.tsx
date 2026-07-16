import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  Alert, ActivityIndicator,
} from 'react-native';
import { getMemberByCode, farmerPeriodReport, FarmerPeriodData, insertPayout } from '../lib/db';
import { getSettings } from '../lib/settings';
import { exportPaymentReportPdf } from '../lib/print';
import DatePickerInput from '../components/DatePickerInput';
import { useSubscription } from '../context/SubscriptionContext';

const ymd = (d: Date) => d.toISOString().slice(0, 10);

// Preset cycle helpers
const CYCLE_PRESETS = [
  { label: '10-day', days: 10 },
  { label: '15-day', days: 15 },
  { label: '30-day', days: 30 },
];

function cycleDates(days: number) {
  const to = ymd(new Date());
  const from = ymd(new Date(Date.now() - (days - 1) * 86400000));
  return { from, to };
}

export default function PaymentReportScreen() {
  const { guard } = useSubscription();
  const today = ymd(new Date());
  const monthAgo = ymd(new Date(Date.now() - 29 * 86400000));
  const [code, setCode] = useState('');
  const [memberName, setMemberName] = useState<string | null>(null);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<FarmerPeriodData | null>(null);
  const [societyName, setSocietyName] = useState('My Dairy');
  const [sharing, setSharing] = useState(false);
  const [paying, setPaying] = useState(false);

  useEffect(() => { getSettings().then((s) => setSocietyName(s.societyName)); }, []);

  useEffect(() => {
    const c = parseInt(code, 10);
    if (!c) { setMemberName(null); setReport(null); return; }
    getMemberByCode(c).then((m) => setMemberName(m?.name ?? null));
  }, [code]);

  const generate = useCallback(async () => {
    const c = parseInt(code, 10);
    if (!c) return Alert.alert('Missing', 'Enter member code');
    if (!memberName) return Alert.alert('Unknown', `No member #${c}`);
    setReport(await farmerPeriodReport(c, from, to));
  }, [code, memberName, from, to]);

  const applyPreset = (days: number) => {
    const { from: f, to: t } = cycleDates(days);
    setFrom(f);
    setTo(t);
    setReport(null);
  };

  const share = async () => {
    if (!report) return;
    setSharing(true);
    const r = await exportPaymentReportPdf({
      society: societyName, memberName: memberName ?? '', membercode: parseInt(code), from, to, data: report,
    });
    setSharing(false);
    if (r.error) Alert.alert('Export failed', r.error);
  };

  const payNow = () => {
    if (!guard()) return;
    if (!report || !report.netPayable || report.netPayable <= 0) {
      return Alert.alert('Nothing due', 'Net payable is ₹0 or negative.');
    }
    const amt = Math.round(report.netPayable);
    Alert.alert(
      'Record cash payout?',
      `Pay ₹${amt} to ${memberName} for this period (${from} – ${to})?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Pay ₹${amt}`,
          onPress: async () => {
            setPaying(true);
            try {
              await insertPayout({
                membercode: parseInt(code),
                amount: amt,
                method: 'cash',
                note: `Cycle ${from} to ${to}`,
              });
              // Re-generate report to show zero balance
              setReport(await farmerPeriodReport(parseInt(code), from, to));
              Alert.alert('✅ Paid', `₹${amt} recorded for ${memberName}.`);
            } catch (e: any) {
              Alert.alert('Error', e.message ?? String(e));
            } finally {
              setPaying(false);
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.label}>Member code</Text>
        <TextInput
          style={styles.bigInput} keyboardType="number-pad" value={code} onChangeText={setCode}
          placeholder="000" placeholderTextColor="#bcc" autoFocus
        />
        <Text style={[styles.memberName, !memberName && code ? styles.memberMissing : null]}>
          {code ? (memberName ?? '⚠︎ unknown') : ' '}
        </Text>

        {/* Date range */}
        <View style={styles.dateRow}>
          <View style={{ flex: 1 }}>
            <DatePickerInput label="From" value={from} onChange={(v) => { setFrom(v); setReport(null); }} />
          </View>
          <View style={{ width: 12 }} />
          <View style={{ flex: 1 }}>
            <DatePickerInput label="To" value={to} onChange={(v) => { setTo(v); setReport(null); }} />
          </View>
        </View>

        {/* Cycle preset buttons */}
        <Text style={styles.label}>Quick cycle</Text>
        <View style={styles.presetRow}>
          {CYCLE_PRESETS.map((p) => (
            <TouchableOpacity key={p.days} style={styles.presetBtn} onPress={() => applyPreset(p.days)}>
              <Text style={styles.presetText}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.genBtn} onPress={generate}>
          <Text style={styles.genText}>Generate report</Text>
        </TouchableOpacity>
      </View>

      {report && (
        <>
          {/* Summary */}
          <View style={styles.summaryCard}>
            <SummaryRow label="Milk earnings" value={`₹${report.totalMilk.toFixed(0)}`} color="#1b9c66" />
            <SummaryRow label="Deductions (kapat)" value={`−₹${report.totalDeductions.toFixed(0)}`} color="#c0392b" />
            <SummaryRow label="Jama (credit)" value={`+₹${report.totalJama.toFixed(0)}`} color="#1b9c66" />
            <SummaryRow label="Udhar (debit)" value={`−₹${report.totalUdhar.toFixed(0)}`} color="#c0392b" />
            <SummaryRow label="Payouts paid" value={`−₹${report.totalPayouts.toFixed(0)}`} color="#c0392b" />
            <View style={styles.netRow}>
              <Text style={styles.netLabel}>Net payable</Text>
              <Text style={[styles.netValue, { color: report.netPayable >= 0 ? '#1b9c66' : '#c0392b' }]}>
                {report.netPayable >= 0 ? '' : '−'}₹{Math.abs(report.netPayable).toFixed(0)}
              </Text>
            </View>
          </View>

          {/* Action buttons */}
          <View style={styles.actionRow}>
            <TouchableOpacity style={[styles.actionBtn, styles.shareBtn]} onPress={share} disabled={sharing}>
              {sharing ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionText}>⤓ Share PDF</Text>}
            </TouchableOpacity>
            {report.netPayable > 0 && (
              <TouchableOpacity style={[styles.actionBtn, styles.payBtn]} onPress={payNow} disabled={paying}>
                {paying ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionText}>💵 Pay ₹{Math.round(report.netPayable)}</Text>}
              </TouchableOpacity>
            )}
          </View>

          {/* Collections detail */}
          <Text style={styles.section}>Milk collections ({report.collections.length})</Text>
          {report.collections.length === 0 ? <Text style={styles.none}>None</Text> :
            report.collections.map((c, i) => (
              <View key={i} style={[styles.detailRow, i % 2 === 0 && styles.altRow]}>
                <Text style={[styles.detCell, { flex: 1.3 }]}>{c.collect_date?.slice(5)} · {c.session === 0 ? 'AM' : 'PM'}</Text>
                <Text style={[styles.detCell, styles.right]}>{c.weight}L</Text>
                <Text style={[styles.detCell, styles.right]}>{c.fat}%</Text>
                <Text style={[styles.detCell, styles.right, { fontWeight: '700', color: '#1b9c66' }]}>₹{Number(c.pay_price).toFixed(0)}</Text>
              </View>
            ))}

          {/* Ledger entries */}
          {report.ledger.length > 0 && (
            <>
              <Text style={styles.section}>Ledger ({report.ledger.length})</Text>
              {report.ledger.map((l, i) => (
                <View key={i} style={[styles.detailRow, i % 2 === 0 && styles.altRow]}>
                  <Text style={[styles.detCell, { flex: 1.5 }]}>{l.entry_date?.slice(5)} · {l.kind}</Text>
                  <Text style={[styles.detCell, { flex: 1 }]}>{l.note || '—'}</Text>
                  <Text style={[styles.detCell, styles.right, { fontWeight: '700', color: l.kind === 'jama' ? '#1b9c66' : '#c0392b' }]}>
                    {l.kind === 'jama' ? '+' : '−'}₹{Number(l.amount).toFixed(0)}
                  </Text>
                </View>
              ))}
            </>
          )}

          {/* Payouts */}
          {report.payouts.length > 0 && (
            <>
              <Text style={styles.section}>Payouts ({report.payouts.length})</Text>
              {report.payouts.map((p, i) => (
                <View key={i} style={[styles.detailRow, i % 2 === 0 && styles.altRow]}>
                  <Text style={[styles.detCell, { flex: 1.5 }]}>{(p.paid_at ?? '').slice(0, 10)?.slice(5)}</Text>
                  <Text style={[styles.detCell, { flex: 1 }]}>{p.method === 'cash' ? '💵' : '📱'} {p.method}</Text>
                  <Text style={[styles.detCell, styles.right, { fontWeight: '700', color: '#c0392b' }]}>−₹{Number(p.amount).toFixed(0)}</Text>
                </View>
              ))}
            </>
          )}
          <View style={{ height: 30 }} />
        </>
      )}
    </ScrollView>
  );
}

function SummaryRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.sumRow}>
      <Text style={styles.sumLabel}>{label}</Text>
      <Text style={[styles.sumValue, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f3f5f7' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16 },
  label: { color: '#4a5a6a', marginTop: 10, marginBottom: 6, fontWeight: '600', fontSize: 13 },
  bigInput: { borderWidth: 1, borderColor: '#dde', borderRadius: 10, padding: 12, fontSize: 28, fontWeight: '800', color: '#0d1b2a', textAlign: 'center' },
  memberName: { textAlign: 'center', marginVertical: 8, fontSize: 16, fontWeight: '700', color: '#1b9c66', minHeight: 22 },
  memberMissing: { color: '#c0392b' },
  dateRow: { flexDirection: 'row', gap: 10 },
  dateInput: { backgroundColor: '#f8f9fa', borderWidth: 1, borderColor: '#dde', borderRadius: 10, padding: 12, fontSize: 15, color: '#111' },
  presetRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  presetBtn: { flex: 1, backgroundColor: '#f0f4ff', borderWidth: 1, borderColor: '#c0cff8', borderRadius: 8, padding: 10, alignItems: 'center' },
  presetText: { color: '#2a6fdb', fontWeight: '700', fontSize: 13 },
  genBtn: { backgroundColor: '#0d7a86', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 14 },
  genText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  summaryCard: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginTop: 16 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  sumLabel: { color: '#4a5a6a', fontSize: 14 },
  sumValue: { fontWeight: '800', fontSize: 16 },
  netRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 2, borderTopColor: '#0d1b2a', paddingTop: 10, marginTop: 8 },
  netLabel: { color: '#0d1b2a', fontWeight: '800', fontSize: 16 },
  netValue: { fontWeight: '900', fontSize: 24 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  actionBtn: { flex: 1, padding: 14, borderRadius: 12, alignItems: 'center' },
  shareBtn: { backgroundColor: '#0d7a86' },
  payBtn: { backgroundColor: '#1b9c66' },
  actionText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  section: { fontWeight: '800', color: '#0d1b2a', marginTop: 22, marginBottom: 6, fontSize: 14 },
  none: { color: '#8a97a6', fontStyle: 'italic' },
  detailRow: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 6, padding: 10, marginBottom: 3, alignItems: 'center' },
  altRow: { backgroundColor: '#f8f9fa' },
  detCell: { flex: 1, color: '#0d1b2a', fontSize: 13 },
  right: { textAlign: 'right' },
});

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { datewiseSummary, DatewiseRow } from '../lib/db';
import { getSettings } from '../lib/settings';
import { exportDatewiseReportPdf } from '../lib/print';
import DatePickerInput from '../components/DatePickerInput';

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export default function DatewiseReportScreen() {
  const today = ymd(new Date());
  const weekAgo = ymd(new Date(Date.now() - 6 * 86400000));
  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<DatewiseRow[]>([]);
  const [societyName, setSocietyName] = useState('My Dairy');
  const [sharing, setSharing] = useState(false);

  useEffect(() => { getSettings().then((s) => setSocietyName(s.societyName)); }, []);

  const load = useCallback(async () => {
    if (from && to) setRows(await datewiseSummary(from, to));
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  // totals
  const totalAm = rows.reduce((s, r) => s + Number(r.amLitres), 0);
  const totalPm = rows.reduce((s, r) => s + Number(r.pmLitres), 0);
  const totalLitres = rows.reduce((s, r) => s + Number(r.totalLitres), 0);
  const totalAmount = rows.reduce((s, r) => s + Number(r.amount), 0);
  const totalCount = rows.reduce((s, r) => s + Number(r.count), 0);
  const avgFat = totalCount > 0 ? rows.reduce((s, r) => s + Number(r.avgFat) * Number(r.count), 0) / totalCount : 0;

  const share = async () => {
    setSharing(true);
    const r = await exportDatewiseReportPdf({
      society: societyName,
      from, to, rows,
      totals: { amLitres: totalAm, pmLitres: totalPm, totalLitres, avgFat, amount: totalAmount, count: totalCount },
    });
    setSharing(false);
    if (r.error) Alert.alert('Export failed', r.error);
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.dateRow}>
        <View style={{ flex: 1 }}>
          <DatePickerInput label="From" value={from} onChange={setFrom} />
        </View>
        <View style={{ width: 12 }} />
        <View style={{ flex: 1 }}>
          <DatePickerInput label="To" value={to} onChange={setTo} />
        </View>
      </View>

      {/* summary cards */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}><Text style={styles.summaryVal}>{totalLitres.toFixed(1)}</Text><Text style={styles.summaryLbl}>Total L</Text></View>
        <View style={styles.summaryCard}><Text style={styles.summaryVal}>₹{totalAmount.toFixed(0)}</Text><Text style={styles.summaryLbl}>Amount</Text></View>
        <View style={styles.summaryCard}><Text style={styles.summaryVal}>{avgFat.toFixed(1)}%</Text><Text style={styles.summaryLbl}>Avg Fat</Text></View>
      </View>

      <TouchableOpacity style={styles.shareBtn} onPress={share} disabled={sharing}>
        {sharing ? <ActivityIndicator color="#fff" /> : <Text style={styles.shareText}>⤓ Share / print (PDF)</Text>}
      </TouchableOpacity>

      {/* table header */}
      <View style={styles.thead}>
        <Text style={[styles.th, { flex: 1.4 }]}>Date</Text>
        <Text style={[styles.th, styles.right]}>AM</Text>
        <Text style={[styles.th, styles.right]}>PM</Text>
        <Text style={[styles.th, styles.right]}>Total</Text>
        <Text style={[styles.th, styles.right]}>Fat%</Text>
        <Text style={[styles.th, styles.right]}>₹</Text>
      </View>

      {rows.length === 0 ? (
        <Text style={styles.empty}>No data for this range</Text>
      ) : (
        <>
          {rows.map((r, i) => (
            <View key={r.date} style={[styles.trow, i % 2 === 0 && styles.trowAlt]}>
              <Text style={[styles.td, { flex: 1.4, fontWeight: '600' }]}>{r.date.slice(5)}</Text>
              <Text style={[styles.td, styles.right]}>{Number(r.amLitres).toFixed(1)}</Text>
              <Text style={[styles.td, styles.right]}>{Number(r.pmLitres).toFixed(1)}</Text>
              <Text style={[styles.td, styles.right, { fontWeight: '700' }]}>{Number(r.totalLitres).toFixed(1)}</Text>
              <Text style={[styles.td, styles.right]}>{Number(r.avgFat).toFixed(1)}</Text>
              <Text style={[styles.td, styles.right, { fontWeight: '700', color: '#1b9c66' }]}>{Number(r.amount).toFixed(0)}</Text>
            </View>
          ))}
          {/* totals row */}
          <View style={styles.totalRow}>
            <Text style={[styles.totalTd, { flex: 1.4 }]}>TOTAL</Text>
            <Text style={[styles.totalTd, styles.right]}>{totalAm.toFixed(1)}</Text>
            <Text style={[styles.totalTd, styles.right]}>{totalPm.toFixed(1)}</Text>
            <Text style={[styles.totalTd, styles.right]}>{totalLitres.toFixed(1)}</Text>
            <Text style={[styles.totalTd, styles.right]}>{avgFat.toFixed(1)}</Text>
            <Text style={[styles.totalTd, styles.right]}>₹{totalAmount.toFixed(0)}</Text>
          </View>
        </>
      )}
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f3f5f7' },
  dateRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  label: { color: '#4a5a6a', fontWeight: '600', fontSize: 12, marginBottom: 4 },
  dateInput: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#dde', borderRadius: 10, padding: 12, fontSize: 15, color: '#111' },
  summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  summaryCard: { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 12, alignItems: 'center' },
  summaryVal: { fontSize: 20, fontWeight: '800', color: '#0d7a86' },
  summaryLbl: { color: '#67788a', fontSize: 11, marginTop: 2 },
  shareBtn: { backgroundColor: '#0d7a86', padding: 14, borderRadius: 12, alignItems: 'center', marginBottom: 14 },
  shareText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  thead: { flexDirection: 'row', paddingHorizontal: 8, paddingBottom: 6 },
  th: { flex: 1, color: '#8a97a6', fontSize: 11, fontWeight: '700' },
  right: { textAlign: 'right' },
  trow: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 6, padding: 10, marginBottom: 3, alignItems: 'center' },
  trowAlt: { backgroundColor: '#f8f9fa' },
  td: { flex: 1, color: '#0d1b2a', fontSize: 13 },
  totalRow: { flexDirection: 'row', backgroundColor: '#0d1b2a', borderRadius: 8, padding: 10, marginTop: 4, alignItems: 'center' },
  totalTd: { flex: 1, color: '#fff', fontSize: 13, fontWeight: '800' },
  empty: { color: '#8a97a6', fontStyle: 'italic', textAlign: 'center', marginTop: 20 },
});

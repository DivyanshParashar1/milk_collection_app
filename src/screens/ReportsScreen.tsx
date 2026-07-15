import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { collectionSummary, collectionByFarmer, payoutSummary, CollectionSummary } from '../lib/db';
import { getSettings } from '../lib/settings';
import { exportReportPdf } from '../lib/print';

type Preset = 'today' | 'yesterday' | '7d' | 'month' | 'all';
const PRESETS: { id: Preset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: '7 days' },
  { id: 'month', label: 'Month' },
  { id: 'all', label: 'All' },
];

const ymd = (d: Date) => d.toISOString().slice(0, 10);
function presetRange(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const today = ymd(now);
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'yesterday') {
    const y = new Date(now); y.setUTCDate(y.getUTCDate() - 1);
    return { from: ymd(y), to: ymd(y) };
  }
  if (preset === '7d') {
    const s = new Date(now); s.setUTCDate(s.getUTCDate() - 6);
    return { from: ymd(s), to: today };
  }
  if (preset === 'month') {
    const s = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { from: ymd(s), to: today };
  }
  return { from: '0000-01-01', to: '9999-12-31' };
}

export default function ReportsScreen({ navigation }: any) {
  const [preset, setPreset] = useState<Preset>('today');
  const [summary, setSummary] = useState<CollectionSummary>({ litres: 0, amount: 0, count: 0, avgFat: 0, amLitres: 0, pmLitres: 0 });
  const [payout, setPayout] = useState({ cash: 0, upi: 0, total: 0, count: 0 });
  const [farmers, setFarmers] = useState<any[]>([]);
  const [societyName, setSocietyName] = useState('My Dairy');
  const [sharing, setSharing] = useState(false);

  useEffect(() => { getSettings().then((st) => setSocietyName(st.societyName)); }, []);

  const load = useCallback(async (p: Preset) => {
    const { from, to } = presetRange(p);
    setSummary(await collectionSummary(from, to));
    setPayout(await payoutSummary(from, to));
    setFarmers(await collectionByFarmer(from, to));
  }, []);

  useFocusEffect(useCallback(() => { load(preset); }, [preset, load]));

  const share = async () => {
    const { from, to } = presetRange(preset);
    const label = PRESETS.find((p) => p.id === preset)!.label + (preset === 'today' || preset === 'yesterday' ? ` (${from})` : ` (${from} → ${to})`);
    setSharing(true);
    const r = await exportReportPdf({
      society: societyName,
      periodLabel: label,
      litres: summary.litres, amount: summary.amount, avgFat: summary.avgFat, count: summary.count,
      amLitres: summary.amLitres, pmLitres: summary.pmLitres,
      cash: payout.cash, upi: payout.upi,
      farmers: farmers.map((f) => ({ membercode: f.membercode, name: f.name, litres: f.litres, amount: f.amount })),
    });
    setSharing(false);
    if (r.error) Alert.alert('Export failed', r.error);
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.presetRow}>
        {PRESETS.map((p) => (
          <TouchableOpacity key={p.id} style={[styles.chip, preset === p.id && styles.chipOn]} onPress={() => setPreset(p.id)}>
            <Text style={[styles.chipText, preset === p.id && styles.chipTextOn]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* collection summary */}
      <View style={styles.statGrid}>
        <Stat label="Litres · लीटर" value={summary.litres.toFixed(1)} big />
        <Stat label="Amount ₹" value={summary.amount.toFixed(0)} big />
        <Stat label="Avg Fat %" value={summary.avgFat.toFixed(1)} />
        <Stat label="Entries" value={String(summary.count)} />
      </View>

      {/* session split */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Session split (litres)</Text>
        <View style={styles.splitRow}>
          <View style={styles.splitItem}><Text style={styles.splitVal}>{summary.amLitres.toFixed(1)}</Text><Text style={styles.splitLbl}>🌅 Morning</Text></View>
          <View style={styles.splitDivider} />
          <View style={styles.splitItem}><Text style={styles.splitVal}>{summary.pmLitres.toFixed(1)}</Text><Text style={styles.splitLbl}>🌇 Evening</Text></View>
        </View>
      </View>

      {/* payouts */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Payments made</Text>
        <View style={styles.splitRow}>
          <View style={styles.splitItem}><Text style={styles.payVal}>₹{payout.cash.toFixed(0)}</Text><Text style={styles.splitLbl}>💵 Cash</Text></View>
          <View style={styles.splitDivider} />
          <View style={styles.splitItem}><Text style={styles.payVal}>₹{payout.upi.toFixed(0)}</Text><Text style={styles.splitLbl}>📱 UPI</Text></View>
          <View style={styles.splitDivider} />
          <View style={styles.splitItem}><Text style={[styles.payVal, { color: '#0d1b2a' }]}>₹{payout.total.toFixed(0)}</Text><Text style={styles.splitLbl}>Total</Text></View>
        </View>
      </View>

      <TouchableOpacity style={styles.shareBtn} onPress={share} disabled={sharing}>
        {sharing ? <ActivityIndicator color="#fff" /> : <Text style={styles.shareText}>⤓  Share / print report (PDF)</Text>}
      </TouchableOpacity>

      <TouchableOpacity style={[styles.shareBtn, { backgroundColor: '#2a6fdb' }]} onPress={() => navigation.navigate('DatewiseReport')}>
        <Text style={styles.shareText}>📅  Datewise detail report</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.shareBtn, { backgroundColor: '#6c5ce7' }]} onPress={() => navigation.navigate('PaymentReport')}>
        <Text style={styles.shareText}>💳  Payment report (farmer bill)</Text>
      </TouchableOpacity>

      {/* per-farmer breakdown */}
      <Text style={styles.section}>By farmer ({farmers.length})</Text>
      {farmers.length === 0 ? (
        <Text style={styles.none}>No collections in this period</Text>
      ) : (
        <>
          <View style={styles.fHead}>
            <Text style={[styles.fCol, { flex: 0.6 }]}>Code</Text>
            <Text style={[styles.fCol, { flex: 1.6 }]}>Name</Text>
            <Text style={[styles.fCol, styles.fRight]}>Litres</Text>
            <Text style={[styles.fCol, styles.fRight]}>₹</Text>
          </View>
          {farmers.map((f) => (
            <View key={f.membercode} style={styles.fRow}>
              <Text style={[styles.fCell, { flex: 0.6, fontWeight: '800', color: '#2a6fdb' }]}>{f.membercode}</Text>
              <Text style={[styles.fCell, { flex: 1.6 }]} numberOfLines={1}>{f.name ?? '—'}</Text>
              <Text style={[styles.fCell, styles.fRight]}>{Number(f.litres).toFixed(1)}</Text>
              <Text style={[styles.fCell, styles.fRight, { fontWeight: '800', color: '#1b9c66' }]}>{Number(f.amount).toFixed(0)}</Text>
            </View>
          ))}
        </>
      )}
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <View style={[styles.stat, big && styles.statBig]}>
      <Text style={[styles.statValue, big && styles.statValueBig]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f3f5f7' },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: { borderWidth: 1, borderColor: '#ccd', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#fff' },
  chipOn: { backgroundColor: '#0d1b2a', borderColor: '#0d1b2a' },
  chipText: { color: '#4a5a6a', fontWeight: '700' },
  chipTextOn: { color: '#fff' },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  stat: { width: '47.5%', backgroundColor: '#fff', borderRadius: 14, padding: 16, alignItems: 'center' },
  statBig: {},
  statValue: { fontSize: 22, fontWeight: '800', color: '#0d1b2a' },
  statValueBig: { fontSize: 30, color: '#1b9c66' },
  statLabel: { color: '#67788a', marginTop: 4, fontSize: 12 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 12 },
  cardTitle: { color: '#67788a', fontWeight: '700', fontSize: 13, marginBottom: 12 },
  splitRow: { flexDirection: 'row', alignItems: 'center' },
  splitItem: { flex: 1, alignItems: 'center' },
  splitDivider: { width: 1, height: 34, backgroundColor: '#e5e9ee' },
  splitVal: { fontSize: 22, fontWeight: '800', color: '#2a6fdb' },
  payVal: { fontSize: 20, fontWeight: '800', color: '#1b9c66' },
  splitLbl: { color: '#67788a', fontSize: 12, marginTop: 4 },
  shareBtn: { backgroundColor: '#0d7a86', padding: 15, borderRadius: 12, alignItems: 'center', marginTop: 4, marginBottom: 4 },
  shareText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  section: { fontWeight: '800', color: '#0d1b2a', marginTop: 12, marginBottom: 8, fontSize: 15 },
  none: { color: '#8a97a6', fontStyle: 'italic' },
  fHead: { flexDirection: 'row', paddingHorizontal: 12, paddingBottom: 6 },
  fCol: { flex: 1, color: '#8a97a6', fontSize: 12, fontWeight: '700' },
  fRight: { textAlign: 'right' },
  fRow: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 6, alignItems: 'center' },
  fCell: { flex: 1, color: '#0d1b2a' },
});

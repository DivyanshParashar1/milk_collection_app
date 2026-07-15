import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import KeyboardAwareScreen from "../components/KeyboardAwareScreen";
import { getRateChart, setRateChart } from '../lib/db';
import { linearRateChart } from '../lib/calc';

type Row = { fat: string; rate: string };

export default function RateChartScreen({ navigation }: any) {
  const [mode, setMode] = useState<'simple' | 'table'>('simple');
  const [perPoint, setPerPoint] = useState('8');
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);

  // load the current chart, guess a per-point value, prepare editable rows
  useEffect(() => {
    (async () => {
      const chart = await getRateChart();
      const withFat = chart.filter((e) => e.fat > 0);
      const mid = withFat[Math.floor(withFat.length / 2)];
      const guess = mid ? Math.round((mid.rate / mid.fat) * 100) / 100 : 8;
      setPerPoint(String(guess));

      if (chart.length > 0 && chart.length <= 24) {
        // already a sparse/custom chart → edit it directly
        setRows(chart.map((e) => ({ fat: String(e.fat), rate: String(e.rate) })));
      } else {
        // dense/generated chart → seed the table with integer fat breakpoints
        const seed: Row[] = [];
        for (let f = 3; f <= 10; f++) seed.push({ fat: String(f), rate: String(Math.round(f * guess)) });
        setRows(seed);
      }
    })();
  }, []);

  const preview = [4, 5, 6, 7, 8].map((f) => ({ fat: f, rate: Math.round(f * (parseFloat(perPoint) || 0)) }));

  const saveSimple = async () => {
    const p = parseFloat(perPoint);
    if (!(p > 0)) return Alert.alert('Enter a number', 'Rate per fat point, e.g. 8');
    setSaving(true);
    try {
      await setRateChart(linearRateChart(p));
      Alert.alert('Saved ✓', `Milk rate = fat × ₹${p}.\nApplied to the collection screen.`, [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } finally {
      setSaving(false);
    }
  };

  const saveTable = async () => {
    const entries = rows
      .map((r) => ({ fat: parseFloat(r.fat), rate: parseFloat(r.rate) }))
      .filter((e) => isFinite(e.fat) && e.fat > 0 && isFinite(e.rate) && e.rate >= 0)
      .sort((a, b) => a.fat - b.fat);
    if (!entries.length) return Alert.alert('Empty', 'Add at least one fat → rate row');
    setSaving(true);
    try {
      await setRateChart(entries);
      Alert.alert('Saved ✓', `${entries.length} rate rows saved.`, [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } finally {
      setSaving(false);
    }
  };

  const setRow = (i: number, key: keyof Row, v: string) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: v } : r)));
  const addRow = () => setRows((rs) => [...rs, { fat: '', rate: '' }]);
  const delRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));

  return (
    <KeyboardAwareScreen style={styles.wrap} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <View style={styles.modeRow}>
        <TouchableOpacity style={[styles.mode, mode === 'simple' && styles.modeOn]} onPress={() => setMode('simple')}>
          <Text style={[styles.modeText, mode === 'simple' && styles.modeTextOn]}>Simple</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.mode, mode === 'table' && styles.modeOn]} onPress={() => setMode('table')}>
          <Text style={[styles.modeText, mode === 'table' && styles.modeTextOn]}>Custom table</Text>
        </TouchableOpacity>
      </View>

      {mode === 'simple' ? (
        <>
          <Text style={styles.help}>Milk rate = Fat % × this number. Simplest option.</Text>
          <Text style={styles.label}>₹ per fat point / प्रति फैट रेट</Text>
          <TextInput style={styles.bigInput} keyboardType="decimal-pad" value={perPoint} onChangeText={setPerPoint} placeholder="8" placeholderTextColor="#bcc" />

          <View style={styles.previewCard}>
            <Text style={styles.previewTitle}>Preview</Text>
            {preview.map((p) => (
              <View key={p.fat} style={styles.previewRow}>
                <Text style={styles.previewFat}>{p.fat.toFixed(1)}% fat</Text>
                <Text style={styles.previewArrow}>→</Text>
                <Text style={styles.previewRate}>₹{p.rate}/L</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity style={styles.saveBtn} onPress={saveSimple} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save rate</Text>}
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.help}>Enter key fat points and their rate. Between two points, the app uses the rate of the nearest fat at or below the measured fat.</Text>

          <View style={styles.tableHead}>
            <Text style={styles.thFat}>Fat %</Text>
            <Text style={styles.thRate}>Rate ₹/L</Text>
            <Text style={styles.thDel} />
          </View>
          {rows.map((r, i) => (
            <View key={i} style={styles.tableRow}>
              <TextInput style={styles.cellFat} keyboardType="decimal-pad" value={r.fat} onChangeText={(v) => setRow(i, 'fat', v)} placeholder="0.0" placeholderTextColor="#bcc" />
              <TextInput style={styles.cellRate} keyboardType="decimal-pad" value={r.rate} onChangeText={(v) => setRow(i, 'rate', v)} placeholder="0" placeholderTextColor="#bcc" />
              <TouchableOpacity style={styles.delBtn} onPress={() => delRow(i)}><Text style={styles.delX}>✕</Text></TouchableOpacity>
            </View>
          ))}

          <TouchableOpacity style={styles.addBtn} onPress={addRow}><Text style={styles.addText}>+ Add row</Text></TouchableOpacity>
          <TouchableOpacity style={styles.saveBtn} onPress={saveTable} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save table</Text>}
          </TouchableOpacity>
        </>
      )}
    </KeyboardAwareScreen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f3f5f7' },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  mode: { flex: 1, borderWidth: 1, borderColor: '#ccd', borderRadius: 10, padding: 12, alignItems: 'center', backgroundColor: '#fff' },
  modeOn: { backgroundColor: '#c0392b', borderColor: '#c0392b' },
  modeText: { color: '#4a5a6a', fontWeight: '700' },
  modeTextOn: { color: '#fff' },
  help: { color: '#67788a', fontSize: 13, marginBottom: 14, lineHeight: 18 },
  label: { color: '#4a5a6a', marginBottom: 6, fontWeight: '700', fontSize: 15 },
  bigInput: { backgroundColor: '#fff', borderWidth: 2, borderColor: '#c0392b', borderRadius: 12, padding: 12, fontSize: 34, fontWeight: '800', color: '#0d1b2a', textAlign: 'center' },
  previewCard: { backgroundColor: '#0d1b2a', borderRadius: 14, padding: 16, marginTop: 18 },
  previewTitle: { color: '#8fb', fontSize: 13, marginBottom: 8, fontWeight: '700' },
  previewRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  previewFat: { color: '#fff', fontSize: 15, width: 90 },
  previewArrow: { color: '#67788a' },
  previewRate: { color: '#43e08e', fontSize: 17, fontWeight: '800', width: 90, textAlign: 'right' },
  saveBtn: { backgroundColor: '#1b9c66', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 20 },
  saveText: { color: '#fff', fontWeight: '800', fontSize: 17 },
  tableHead: { flexDirection: 'row', paddingHorizontal: 4, marginBottom: 6 },
  thFat: { flex: 1, color: '#67788a', fontWeight: '700', fontSize: 13 },
  thRate: { flex: 1, color: '#67788a', fontWeight: '700', fontSize: 13 },
  thDel: { width: 40 },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  cellFat: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#dde', borderRadius: 8, padding: 12, fontSize: 16, textAlign: 'center', color: '#111' },
  cellRate: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#dde', borderRadius: 8, padding: 12, fontSize: 16, textAlign: 'center', color: '#111' },
  delBtn: { width: 40, height: 40, borderRadius: 8, backgroundColor: '#fdecea', alignItems: 'center', justifyContent: 'center' },
  delX: { color: '#c0392b', fontWeight: '800', fontSize: 16 },
  addBtn: { borderWidth: 1, borderColor: '#1b9c66', borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 4 },
  addText: { color: '#1b9c66', fontWeight: '700' },
});

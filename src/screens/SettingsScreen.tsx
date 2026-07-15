import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator, Switch } from 'react-native';
import { getSettings, saveSettings, AppSettings, DEFAULT_SETTINGS } from '../lib/settings';
import { backupRateChart, restoreRateChart } from '../lib/sync';

const ROUNDING = [
  { v: 0 as const, label: '2 decimals' },
  { v: 1 as const, label: '1 decimal' },
  { v: 2 as const, label: 'Whole ₹' },
];

export default function SettingsScreen() {
  const [s, setS] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState(false);

  useEffect(() => { getSettings().then(setS); }, []);

  const save = async () => {
    await saveSettings({ ...s, upiHandle: s.upiHandle.replace(/[^a-zA-Z]/g, '') || 'upi', amCutoffHour: Math.min(23, Math.max(0, Math.round(s.amCutoffHour) || 14)) });
    Alert.alert('Saved ✓', 'Settings updated');
  };

  const backup = async () => {
    setBusy(true);
    const r = await backupRateChart();
    setBusy(false);
    Alert.alert(r.error ? 'Backup failed' : 'Backed up ✓', r.error ?? `${r.count} rate rows saved to cloud`);
  };

  const restore = async () => {
    Alert.alert('Restore rate chart?', 'This replaces the rate chart on this device with the cloud copy.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Restore', onPress: async () => {
          setBusy(true);
          const r = await restoreRateChart();
          setBusy(false);
          Alert.alert(r.error ? 'Restore failed' : 'Restored ✓', r.error ?? `${r.count} rate rows loaded from cloud`);
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.label}>Dairy / society name (on slips & reports)</Text>
      <TextInput style={styles.input} value={s.societyName} onChangeText={(v) => setS({ ...s, societyName: v })} placeholder="My Dairy" placeholderTextColor="#9aa" />

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Auto-print slip after each collection</Text>
        <Switch value={s.autoPrintSlip} onValueChange={(v) => setS({ ...s, autoPrintSlip: v })} trackColor={{ true: '#1b9c66' }} />
      </View>

      <Text style={styles.label}>Default UPI handle (for mobile-number payments)</Text>
      <TextInput style={styles.input} autoCapitalize="none" value={s.upiHandle} onChangeText={(v) => setS({ ...s, upiHandle: v })} placeholder="upi / ybl / oksbi / paytm" placeholderTextColor="#9aa" />
      <Text style={styles.hint}>When a farmer has no UPI id, the number is paid as {'<mobile>@' + (s.upiHandle || 'upi')}.</Text>

      <Text style={styles.label}>Amount rounding</Text>
      <View style={styles.segRow}>
        {ROUNDING.map((r) => (
          <TouchableOpacity key={r.v} style={[styles.seg, s.rounding === r.v && styles.segOn]} onPress={() => setS({ ...s, rounding: r.v })}>
            <Text style={[styles.segText, s.rounding === r.v && styles.segTextOn]}>{r.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Morning session until (hour, 24h)</Text>
      <TextInput style={styles.input} keyboardType="number-pad" value={String(s.amCutoffHour)} onChangeText={(v) => setS({ ...s, amCutoffHour: parseInt(v, 10) || 0 })} placeholder="14" placeholderTextColor="#9aa" />
      <Text style={styles.hint}>Entries before this hour default to Morning, after to Evening.</Text>

      <TouchableOpacity style={styles.saveBtn} onPress={save}><Text style={styles.saveText}>Save settings</Text></TouchableOpacity>

      <View style={styles.divider} />
      <Text style={styles.section}>Rate chart backup</Text>
      <Text style={styles.hint}>Save your rate chart to the cloud, or load it onto another device.</Text>
      <View style={styles.btnRow}>
        <TouchableOpacity style={[styles.cloudBtn, styles.backupBtn]} onPress={backup} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.cloudText}>⬆︎ Backup</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={[styles.cloudBtn, styles.restoreBtn]} onPress={restore} disabled={busy}>
          <Text style={styles.cloudText}>⬇︎ Restore</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f3f5f7' },
  label: { color: '#4a5a6a', marginTop: 18, marginBottom: 6, fontWeight: '700', fontSize: 14 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#dde', borderRadius: 10, padding: 13, fontSize: 16, color: '#111' },
  hint: { color: '#8a97a6', fontSize: 12, marginTop: 6 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 10, padding: 14, marginTop: 16 },
  switchLabel: { flex: 1, color: '#0d1b2a', fontWeight: '600', fontSize: 14 },
  segRow: { flexDirection: 'row', gap: 8 },
  seg: { flex: 1, borderWidth: 1, borderColor: '#ccd', borderRadius: 10, padding: 12, alignItems: 'center', backgroundColor: '#fff' },
  segOn: { backgroundColor: '#1b9c66', borderColor: '#1b9c66' },
  segText: { color: '#4a5a6a', fontWeight: '700', fontSize: 13 },
  segTextOn: { color: '#fff' },
  saveBtn: { backgroundColor: '#1b9c66', padding: 15, borderRadius: 12, alignItems: 'center', marginTop: 22 },
  saveText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  divider: { height: 1, backgroundColor: '#e0e5ea', marginVertical: 24 },
  section: { fontWeight: '800', color: '#0d1b2a', fontSize: 16 },
  btnRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  cloudBtn: { flex: 1, padding: 15, borderRadius: 12, alignItems: 'center' },
  backupBtn: { backgroundColor: '#2a6fdb' },
  restoreBtn: { backgroundColor: '#0d7a86' },
  cloudText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});

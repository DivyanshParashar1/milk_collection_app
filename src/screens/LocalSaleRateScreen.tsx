import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import KeyboardAwareScreen from "../components/KeyboardAwareScreen";
import { getLocalSaleRates, setLocalSaleRate } from '../lib/db';

const TYPES = [
  { key: 'cow', label: '🐄 Cow', color: '#1b9c66' },
  { key: 'buff', label: '🐃 Buffalo', color: '#2a6fdb' },
  { key: 'mix', label: '🥛 Mix', color: '#e0821b' },
] as const;

export default function LocalSaleRateScreen() {
  const [rates, setRates] = useState<{ [k: string]: string }>({ cow: '', buff: '', mix: '' });

  useEffect(() => {
    getLocalSaleRates().then((rows) => {
      const m: any = { cow: '', buff: '', mix: '' };
      for (const r of rows) m[r.milk_type] = r.rate_per_litre > 0 ? String(r.rate_per_litre) : '';
      setRates(m);
    });
  }, []);

  const save = async () => {
    for (const t of TYPES) {
      const v = parseFloat(rates[t.key]) || 0;
      await setLocalSaleRate(t.key, v);
    }
    Alert.alert('Saved ✓', 'Sale rates updated');
  };

  return (
    <KeyboardAwareScreen style={styles.wrap} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.hint}>Set the default per-litre rate for local (direct) sales. These can be overridden on each sale.</Text>

      {TYPES.map((t) => (
        <View key={t.key} style={styles.card}>
          <Text style={[styles.typeLabel, { color: t.color }]}>{t.label}</Text>
          <View style={styles.inputRow}>
            <Text style={styles.rs}>₹</Text>
            <TextInput
              style={styles.input}
              keyboardType="decimal-pad"
              value={rates[t.key]}
              onChangeText={(v) => setRates({ ...rates, [t.key]: v })}
              placeholder="0"
              placeholderTextColor="#bcc"
            />
            <Text style={styles.perL}>per litre</Text>
          </View>
        </View>
      ))}

      <TouchableOpacity style={styles.btn} onPress={save}>
        <Text style={styles.btnText}>Save rates</Text>
      </TouchableOpacity>
    </KeyboardAwareScreen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f3f5f7' },
  hint: { color: '#67788a', fontSize: 13, marginBottom: 16, lineHeight: 20 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 12 },
  typeLabel: { fontWeight: '800', fontSize: 16, marginBottom: 10 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rs: { fontSize: 22, fontWeight: '800', color: '#0d1b2a' },
  input: { flex: 1, borderWidth: 1, borderColor: '#dde', borderRadius: 10, padding: 13, fontSize: 22, fontWeight: '700', color: '#111', textAlign: 'center' },
  perL: { color: '#8a97a6', fontSize: 14 },
  btn: { backgroundColor: '#e0821b', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 17 },
});

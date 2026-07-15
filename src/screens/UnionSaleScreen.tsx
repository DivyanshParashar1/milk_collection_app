import React, { useCallback, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import KeyboardAwareScreen from "../components/KeyboardAwareScreen";
import { useFocusEffect } from '@react-navigation/native';
import { insertUnionSale, recentUnionSales, todayUnionSaleTotals } from '../lib/db';

export default function UnionSaleScreen() {
  const [session, setSession] = useState<0 | 1>(new Date().getHours() < 14 ? 0 : 1);
  const [quantity, setQuantity] = useState('');
  const [fat, setFat] = useState('');
  const [snf, setSnf] = useState('');
  const [rate, setRate] = useState('');
  const [unionName, setUnionName] = useState('');
  const [note, setNote] = useState('');
  const [recent, setRecent] = useState<any[]>([]);
  const [totals, setTotals] = useState({ quantity: 0, amount: 0, count: 0 });
  const [saving, setSaving] = useState(false);

  const loadRecent = async () => {
    setRecent(await recentUnionSales(12));
    setTotals(await todayUnionSaleTotals());
  };

  useFocusEffect(useCallback(() => { loadRecent(); }, []));

  const qty = parseFloat(quantity) || 0;
  const fv = parseFloat(fat) || 0;
  const sv = parseFloat(snf) || 0;
  const rv = parseFloat(rate) || 0;
  const amount = qty * rv;
  const kgFat = qty * fv / 100;
  const kgSnf = qty * sv / 100;

  const save = async () => {
    if (!(qty > 0)) return Alert.alert('Missing', 'Enter quantity');
    if (!(rv > 0)) return Alert.alert('Missing', 'Enter rate');

    setSaving(true);
    try {
      await insertUnionSale({
        sale_date: new Date().toISOString().slice(0, 10),
        session,
        quantity: qty,
        fat: fv,
        snf: sv,
        rate: rv,
        amount: Math.round(amount * 100) / 100,
        kg_fat: Math.round(kgFat * 1000) / 1000,
        kg_snf: Math.round(kgSnf * 1000) / 1000,
        union_name: unionName.trim() || undefined,
        note: note.trim() || undefined,
      });
      setQuantity(''); setFat(''); setSnf(''); setNote('');
      await loadRecent();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAwareScreen style={styles.wrap} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      {/* Today stats */}
      <View style={styles.statsRow}>
        <View style={styles.stat}><Text style={styles.statVal}>{totals.quantity.toFixed(1)}</Text><Text style={styles.statLbl}>Litres today</Text></View>
        <View style={styles.stat}><Text style={styles.statVal}>₹{totals.amount.toFixed(0)}</Text><Text style={styles.statLbl}>Amount</Text></View>
        <View style={styles.stat}><Text style={styles.statVal}>{totals.count}</Text><Text style={styles.statLbl}>Sales</Text></View>
      </View>

      {/* Session toggle */}
      <View style={styles.sessionRow}>
        {([[0, 'Morning'], [1, 'Evening']] as const).map(([s, lbl]) => (
          <TouchableOpacity key={s} style={[styles.seg, session === s && styles.segOn]} onPress={() => setSession(s as 0 | 1)}>
            <Text style={[styles.segText, session === s && styles.segTextOn]}>{lbl}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Union / Federation name</Text>
        <TextInput style={styles.input} value={unionName} onChangeText={setUnionName} placeholder="Amul, Gokul…" placeholderTextColor="#bcc" />

        <View style={styles.row3}>
          <View style={{ flex: 1 }}><Text style={styles.label}>Qty (L)</Text><TextInput style={styles.input} keyboardType="decimal-pad" value={quantity} onChangeText={setQuantity} placeholder="0" placeholderTextColor="#bcc" /></View>
          <View style={{ flex: 1 }}><Text style={styles.label}>Fat %</Text><TextInput style={styles.input} keyboardType="decimal-pad" value={fat} onChangeText={setFat} placeholder="0" placeholderTextColor="#bcc" /></View>
          <View style={{ flex: 1 }}><Text style={styles.label}>SNF %</Text><TextInput style={styles.input} keyboardType="decimal-pad" value={snf} onChangeText={setSnf} placeholder="0" placeholderTextColor="#bcc" /></View>
        </View>

        <Text style={styles.label}>Rate ₹/L</Text>
        <TextInput style={styles.input} keyboardType="decimal-pad" value={rate} onChangeText={setRate} placeholder="0" placeholderTextColor="#bcc" />

        <Text style={styles.label}>Note (optional)</Text>
        <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="Can no., bill ref…" placeholderTextColor="#bcc" />

        {/* live calc */}
        <View style={styles.calcBar}>
          <View style={styles.calcItem}><Text style={styles.calcVal}>{kgFat.toFixed(2)}</Text><Text style={styles.calcLbl}>kg Fat</Text></View>
          <View style={styles.calcItem}><Text style={styles.calcVal}>{kgSnf.toFixed(2)}</Text><Text style={styles.calcLbl}>kg SNF</Text></View>
          <View style={styles.calcItem}><Text style={[styles.calcVal, { color: '#43e08e' }]}>₹{amount.toFixed(0)}</Text><Text style={styles.calcLbl}>Amount</Text></View>
        </View>
      </View>

      <TouchableOpacity style={styles.btn} onPress={save} disabled={saving}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Save union sale</Text>}
      </TouchableOpacity>

      {recent.length > 0 && (
        <>
          <Text style={styles.section}>Recent union sales</Text>
          {recent.map((r) => (
            <View key={r.local_id} style={styles.saleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.saleName}>{r.union_name || 'Union'} · {r.session === 0 ? 'AM' : 'PM'}</Text>
                <Text style={styles.saleDetail}>{r.quantity}L · Fat {r.fat}% · Rate ₹{r.rate} · {r.sale_date}</Text>
              </View>
              <Text style={styles.saleAmt}>₹{Number(r.amount).toFixed(0)}</Text>
              <Text style={r.synced ? styles.dotOk : styles.dotPending}>●</Text>
            </View>
          ))}
        </>
      )}
      <View style={{ height: 30 }} />
    </KeyboardAwareScreen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f3f5f7' },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  stat: { flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 14, alignItems: 'center' },
  statVal: { fontSize: 22, fontWeight: '800', color: '#5f27cd' },
  statLbl: { color: '#67788a', marginTop: 4, fontSize: 11 },
  sessionRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  seg: { flex: 1, borderWidth: 1, borderColor: '#ccd', borderRadius: 10, padding: 10, alignItems: 'center', backgroundColor: '#fff' },
  segOn: { backgroundColor: '#5f27cd', borderColor: '#5f27cd' },
  segText: { color: '#4a5a6a', fontWeight: '700' },
  segTextOn: { color: '#fff' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16 },
  label: { color: '#4a5a6a', marginTop: 10, marginBottom: 6, fontWeight: '600', fontSize: 13 },
  input: { borderWidth: 1, borderColor: '#dde', borderRadius: 10, padding: 13, fontSize: 16, color: '#111' },
  row3: { flexDirection: 'row', gap: 10 },
  calcBar: { flexDirection: 'row', backgroundColor: '#0d1b2a', borderRadius: 12, padding: 14, marginTop: 14 },
  calcItem: { flex: 1, alignItems: 'center' },
  calcVal: { color: '#fff', fontWeight: '800', fontSize: 18 },
  calcLbl: { color: '#67788a', fontSize: 10, marginTop: 2 },
  btn: { backgroundColor: '#5f27cd', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 17 },
  section: { fontWeight: '800', color: '#0d1b2a', marginTop: 24, marginBottom: 8, fontSize: 15 },
  saleRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 6, gap: 10 },
  saleName: { fontWeight: '700', color: '#0d1b2a', fontSize: 14 },
  saleDetail: { color: '#67788a', fontSize: 12, marginTop: 2 },
  saleAmt: { fontWeight: '800', fontSize: 16, color: '#5f27cd' },
  dotOk: { color: '#1b9c66', fontSize: 12 },
  dotPending: { color: '#e08e0b', fontSize: 12 },
});

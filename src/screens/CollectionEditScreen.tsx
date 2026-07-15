import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import KeyboardAwareScreen from "../components/KeyboardAwareScreen";
import { computeMilk, RateEntry } from '../lib/calc';
import { getCollection, getMemberByCode, getRateChart } from '../lib/db';
import { saveCollectionEdit, deleteCollection } from '../lib/sync';
import { getSettings } from '../lib/settings';
import { printCollectionSlip } from '../lib/print';

export default function CollectionEditScreen({ route, navigation }: any) {
  const localId: number = route.params.localId;
  const [row, setRow] = useState<any | null>(null);
  const [name, setName] = useState<string>('');
  const [deductionPct, setDeductionPct] = useState(0);
  const [chart, setChart] = useState<RateEntry[]>([]);
  const [weight, setWeight] = useState('');
  const [fat, setFat] = useState('');
  const [snf, setSnf] = useState('');
  const [rounding, setRounding] = useState<0 | 1 | 2>(0);
  const [societyName, setSocietyName] = useState('My Dairy');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const st = await getSettings();
      setRounding(st.rounding);
      setSocietyName(st.societyName);
      const r = await getCollection(localId);
      setRow(r);
      setWeight(String(r?.weight ?? ''));
      setFat(String(r?.fat ?? ''));
      setSnf(r?.snf ? String(r.snf) : '');
      setChart((await getRateChart()) as RateEntry[]);
      if (r) {
        const m = await getMemberByCode(r.membercode);
        setName(m?.name ?? `#${r.membercode}`);
        setDeductionPct(m?.fix_deduction ?? 0);
      }
    })();
  }, [localId]);

  const calc = useMemo(
    () => computeMilk({ weight: parseFloat(weight) || 0, fat: parseFloat(fat) || 0, snf: parseFloat(snf) || 0, deductionPct, roundTo: rounding }, chart),
    [weight, fat, snf, deductionPct, chart, rounding]
  );

  const save = async () => {
    if (!(parseFloat(weight) > 0)) return Alert.alert('Weight', 'Enter a valid weight');
    setBusy(true);
    const { error } = await saveCollectionEdit(row, {
      weight: calc.weight, fat: calc.fat, snf: calc.snf, rate: calc.rate, price: calc.price,
      kg_fat: calc.kgFat, kg_snf: calc.kgSnf, deduction: calc.deduction, pay_price: calc.payPrice,
    });
    setBusy(false);
    if (error) return Alert.alert('Could not save', error);
    Alert.alert('Updated ✓', '', [{ text: 'OK', onPress: () => navigation.goBack() }]);
  };

  const remove = () => {
    Alert.alert('Delete entry?', `${name} · ${row?.weight}L @ ${row?.fat}%`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          setBusy(true);
          const { error } = await deleteCollection(row);
          setBusy(false);
          if (error) return Alert.alert('Could not delete', error);
          navigation.goBack();
        },
      },
    ]);
  };

  const reprint = () =>
    printCollectionSlip({
      society: societyName,
      date: row.collect_date,
      session: row.session === 0 ? 'Morning' : 'Evening',
      code: row.membercode, name,
      weight: calc.weight, fat: calc.fat, snf: calc.snf, rate: calc.rate, amount: calc.price,
    });

  if (!row) return <View style={styles.wrap} />;

  return (
    <KeyboardAwareScreen style={styles.wrap} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <View style={styles.head}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.meta}>{row.collect_date} · {row.session === 0 ? 'Morning' : 'Evening'} · {row.synced ? 'synced' : 'not synced'}</Text>
      </View>

      <View style={styles.row}>
        <View style={styles.col}><Text style={styles.label}>Weight (L)</Text><TextInput style={styles.input} keyboardType="decimal-pad" value={weight} onChangeText={setWeight} /></View>
        <View style={styles.col}><Text style={styles.label}>Fat %</Text><TextInput style={styles.input} keyboardType="decimal-pad" value={fat} onChangeText={setFat} /></View>
        <View style={styles.col}><Text style={styles.label}>SNF %</Text><TextInput style={styles.input} keyboardType="decimal-pad" value={snf} onChangeText={setSnf} placeholder="opt" placeholderTextColor="#bcc" /></View>
      </View>

      <View style={styles.result}>
        <View style={styles.resRow}><Text style={styles.resLbl}>Rate ₹/L</Text><Text style={styles.resVal}>{calc.rate.toFixed(2)}</Text></View>
        <View style={styles.resRow}><Text style={styles.resLbl}>Amount ₹</Text><Text style={[styles.resVal, styles.big]}>{calc.price.toFixed(2)}</Text></View>
        <View style={styles.resRow}><Text style={styles.resLbl}>Payable ₹</Text><Text style={styles.resVal}>{calc.payPrice.toFixed(2)}</Text></View>
      </View>

      <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save changes</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={styles.printBtn} onPress={reprint} disabled={busy}>
        <Text style={styles.printText}>🖨  Reprint slip</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.delBtn} onPress={remove} disabled={busy}>
        <Text style={styles.delText}>Delete entry</Text>
      </TouchableOpacity>
    </KeyboardAwareScreen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f3f5f7' },
  head: { marginBottom: 14 },
  name: { fontSize: 22, fontWeight: '800', color: '#0d1b2a' },
  meta: { color: '#67788a', marginTop: 4 },
  row: { flexDirection: 'row', gap: 10 },
  col: { flex: 1 },
  label: { color: '#4a5a6a', marginBottom: 6, fontWeight: '600', fontSize: 13 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#dde', borderRadius: 10, padding: 13, fontSize: 18, color: '#111', textAlign: 'center' },
  result: { backgroundColor: '#0d1b2a', borderRadius: 14, padding: 16, marginTop: 16 },
  resRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  resLbl: { color: '#8fb', fontSize: 15 },
  resVal: { color: '#fff', fontSize: 19, fontWeight: '700' },
  big: { fontSize: 28, color: '#43e08e', fontWeight: '900' },
  saveBtn: { backgroundColor: '#1b9c66', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 18 },
  saveText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  printBtn: { backgroundColor: '#2a6fdb', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 10 },
  printText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  delBtn: { padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 10, borderWidth: 1, borderColor: '#f0b5ae' },
  delText: { color: '#c0392b', fontWeight: '800' },
});

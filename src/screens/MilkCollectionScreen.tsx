import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { computeMilk, RateEntry } from '../lib/calc';
import { getMemberByCode, getRateChart, insertCollection, recentCollections } from '../lib/db';
import { getSettings } from '../lib/settings';
import { printCollectionSlip } from '../lib/print';

export default function MilkCollectionScreen({ navigation }: any) {
  const [code, setCode] = useState('');
  const [memberName, setMemberName] = useState<string | null>(null);
  const [deductionPct, setDeductionPct] = useState(0);
  const [session, setSession] = useState<0 | 1>(new Date().getHours() < 14 ? 0 : 1);
  const [weight, setWeight] = useState('');
  const [fat, setFat] = useState('');
  const [snf, setSnf] = useState('');
  const [chart, setChart] = useState<RateEntry[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [rounding, setRounding] = useState<0 | 1 | 2>(0);
  const [societyName, setSocietyName] = useState('My Dairy');
  const [autoPrint, setAutoPrint] = useState(false);
  const [saving, setSaving] = useState(false);
  const sessionInit = useRef(false);

  useEffect(() => {
    getSettings().then((st) => {
      setRounding(st.rounding);
      setSocietyName(st.societyName);
      setAutoPrint(st.autoPrintSlip);
      if (!sessionInit.current) {
        setSession(new Date().getHours() < st.amCutoffHour ? 0 : 1);
        sessionInit.current = true;
      }
    });
  }, []);

  const loadRecent = async () => setRecent(await recentCollections(8));

  // reload the rate chart (and recent list) every time the screen is focused,
  // so edits made in the Rate Chart editor take effect immediately.
  useFocusEffect(
    useCallback(() => {
      getRateChart().then((c) => setChart(c as RateEntry[]));
      loadRecent();
    }, [])
  );

  // resolve member name as the code is typed
  useEffect(() => {
    const c = parseInt(code, 10);
    if (!c) { setMemberName(null); setDeductionPct(0); return; }
    getMemberByCode(c).then((m) => {
      setMemberName(m?.name ?? null);
      setDeductionPct(m?.fix_deduction ?? 0);
    });
  }, [code]);

  const calc = useMemo(
    () =>
      computeMilk(
        {
          weight: parseFloat(weight) || 0,
          fat: parseFloat(fat) || 0,
          snf: parseFloat(snf) || 0,
          deductionPct,
          roundTo: rounding,
        },
        chart
      ),
    [weight, fat, snf, deductionPct, chart, rounding]
  );

  const save = async () => {
    const c = parseInt(code, 10);
    if (!c) return Alert.alert('Missing', 'Enter a member code');
    if (!memberName) return Alert.alert('Unknown member', `No member ${c}. Add them first.`);
    if (!(parseFloat(weight) > 0)) return Alert.alert('Missing', 'Enter weight');
    if (calc.rate === 0) return Alert.alert('No rate', 'No rate found for this fat. Check the rate chart.');

    setSaving(true);
    try {
      await insertCollection({
        membercode: c,
        session,
        collect_date: new Date().toISOString().slice(0, 10),
        weight: calc.weight,
        fat: calc.fat,
        snf: calc.snf,
        clr: 0,
        rate: calc.rate,
        price: calc.price,
        kg_fat: calc.kgFat,
        kg_snf: calc.kgSnf,
        deduction: calc.deduction,
        pay_price: calc.payPrice,
      });
      if (autoPrint) {
        await printCollectionSlip({
          society: societyName,
          date: new Date().toISOString().slice(0, 10),
          session: session === 0 ? 'Morning' : 'Evening',
          code: c, name: memberName ?? String(c),
          weight: calc.weight, fat: calc.fat, snf: calc.snf, rate: calc.rate, amount: calc.price,
        });
      }
      // reset for next farmer, keep session
      setCode(''); setWeight(''); setFat(''); setSnf(''); setMemberName(null);
      await loadRecent();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <View style={styles.sessionRow}>
        {([[0, 'Morning'], [1, 'Evening']] as const).map(([s, lbl]) => (
          <TouchableOpacity key={s} style={[styles.seg, session === s && styles.segActive]} onPress={() => setSession(s as 0 | 1)}>
            <Text style={[styles.segText, session === s && styles.segTextActive]}>{lbl}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Member code</Text>
        <TextInput style={styles.bigInput} keyboardType="number-pad" value={code} onChangeText={setCode} placeholder="000" placeholderTextColor="#bcc" autoFocus />
        <Text style={[styles.memberName, !memberName && code ? styles.memberMissing : null]}>
          {code ? (memberName ?? '⚠︎ unknown member') : ' '}
        </Text>

        <View style={styles.row}>
          <View style={styles.col}>
            <Text style={styles.label}>Weight (L)</Text>
            <TextInput style={styles.input} keyboardType="decimal-pad" value={weight} onChangeText={setWeight} placeholder="0.0" placeholderTextColor="#bcc" />
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>Fat %</Text>
            <TextInput style={styles.input} keyboardType="decimal-pad" value={fat} onChangeText={setFat} placeholder="0.0" placeholderTextColor="#bcc" />
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>SNF %</Text>
            <TextInput style={styles.input} keyboardType="decimal-pad" value={snf} onChangeText={setSnf} placeholder="opt" placeholderTextColor="#bcc" />
          </View>
        </View>
      </View>

      {/* live computed result */}
      <View style={styles.result}>
        <ResultRow label="Rate ₹/L" value={calc.rate.toFixed(2)} />
        <ResultRow label="Amount ₹" value={calc.price.toFixed(2)} big />
        <View style={styles.resultMini}>
          <Mini label="kg-fat" value={calc.kgFat.toFixed(2)} />
          <Mini label="kg-snf" value={calc.kgSnf.toFixed(2)} />
          <Mini label="kapat ₹" value={calc.deduction.toFixed(2)} />
          <Mini label="payable ₹" value={calc.payPrice.toFixed(2)} />
        </View>
      </View>

      <TouchableOpacity style={styles.btn} onPress={save} disabled={saving}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Save & next</Text>}
      </TouchableOpacity>

      {recent.length > 0 && (
        <>
          <View style={styles.recentHead}>
            <Text style={styles.recentTitle}>Recent entries</Text>
            <TouchableOpacity onPress={() => navigation.navigate('CollectionHistory')}>
              <Text style={styles.recentLink}>All / edit ›</Text>
            </TouchableOpacity>
          </View>
          {recent.map((r) => (
            <TouchableOpacity key={r.local_id} style={styles.recentRow} onPress={() => navigation.navigate('CollectionEdit', { localId: r.local_id })}>
              <Text style={styles.recentCode}>#{r.membercode}</Text>
              <Text style={styles.recentMid}>{r.weight}L · {r.fat}%</Text>
              <Text style={styles.recentAmt}>₹{Number(r.price).toFixed(0)}</Text>
              <Text style={r.synced ? styles.dotOk : styles.dotPending}>●</Text>
            </TouchableOpacity>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function ResultRow({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <View style={styles.resultRow}>
      <Text style={styles.resultLabel}>{label}</Text>
      <Text style={[styles.resultValue, big && styles.resultValueBig]}>{value}</Text>
    </View>
  );
}
function Mini({ label, value }: { label: string; value: string }) {
  return <View style={styles.mini}><Text style={styles.miniValue}>{value}</Text><Text style={styles.miniLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f3f5f7' },
  sessionRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  seg: { flex: 1, borderWidth: 1, borderColor: '#ccd', borderRadius: 10, padding: 12, alignItems: 'center', backgroundColor: '#fff' },
  segActive: { backgroundColor: '#2a6fdb', borderColor: '#2a6fdb' },
  segText: { color: '#4a5a6a', fontWeight: '700' },
  segTextActive: { color: '#fff' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16 },
  label: { color: '#4a5a6a', marginBottom: 6, fontWeight: '600', fontSize: 13 },
  bigInput: { borderWidth: 1, borderColor: '#dde', borderRadius: 10, padding: 12, fontSize: 30, fontWeight: '800', color: '#0d1b2a', textAlign: 'center' },
  memberName: { textAlign: 'center', marginVertical: 8, fontSize: 16, fontWeight: '700', color: '#1b9c66', minHeight: 22 },
  memberMissing: { color: '#c0392b' },
  row: { flexDirection: 'row', gap: 10, marginTop: 4 },
  col: { flex: 1 },
  input: { borderWidth: 1, borderColor: '#dde', borderRadius: 10, padding: 13, fontSize: 18, color: '#111', textAlign: 'center' },
  result: { backgroundColor: '#0d1b2a', borderRadius: 16, padding: 18, marginTop: 14 },
  resultRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  resultLabel: { color: '#8fb', fontSize: 15 },
  resultValue: { color: '#fff', fontSize: 20, fontWeight: '700' },
  resultValueBig: { fontSize: 34, fontWeight: '800', color: '#43e08e' },
  resultMini: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, borderTopWidth: 1, borderTopColor: '#25384a', paddingTop: 12 },
  mini: { alignItems: 'center', flex: 1 },
  miniValue: { color: '#fff', fontWeight: '700', fontSize: 15 },
  miniLabel: { color: '#67788a', fontSize: 11, marginTop: 2 },
  btn: { backgroundColor: '#1b9c66', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 17 },
  recentHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, marginBottom: 8 },
  recentTitle: { fontWeight: '800', color: '#0d1b2a', fontSize: 15 },
  recentLink: { color: '#2a6fdb', fontWeight: '700' },
  recentRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 6, gap: 10 },
  recentCode: { fontWeight: '800', color: '#0d1b2a', width: 54 },
  recentMid: { flex: 1, color: '#4a5a6a' },
  recentAmt: { fontWeight: '700', color: '#1b9c66' },
  dotOk: { color: '#1b9c66', fontSize: 12 },
  dotPending: { color: '#e08e0b', fontSize: 12 },
});

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import KeyboardAwareScreen from '../components/KeyboardAwareScreen';
import { showHelp } from '../lib/help';
import { useFocusEffect } from '@react-navigation/native';
import { computeMilk, RateEntry } from '../lib/calc';
import { getMemberByCode, getRateChart, insertCollection, recentCollections, isSessionLocked, lockSession, unlockSession } from '../lib/db';
import { getSettings } from '../lib/settings';
import { printCollectionSlip } from '../lib/print';
import { openCollectionSms, SlipData } from '../lib/sms';
import { isThermalAvailable, printCollectionSlipBT } from '../lib/thermal';
import { useSubscription } from '../context/SubscriptionContext';

const WALK_IN = 'Walk-in';
type AnimalType = 'mix' | 'cow' | 'buff';
const ANIMAL_TABS: { type: AnimalType; emoji: string; label: string; color: string }[] = [
  { type: 'mix',  emoji: '🥛', label: 'Mix',     color: '#0d7a86' },
  { type: 'cow',  emoji: '🐄', label: 'Cow',     color: '#1b9c66' },
  { type: 'buff', emoji: '🐃', label: 'Buffalo', color: '#2a6fdb' },
];

export default function MilkCollectionScreen({ route, navigation }: any) {
  const { guard } = useSubscription();
  const [code, setCode] = useState(route.params?.prefillCode ? String(route.params.prefillCode) : '');
  const [memberName, setMemberName] = useState<string | null>(null);
  const [memberMobile, setMemberMobile] = useState<string | null>(null);
  const [deductionPct, setDeductionPct] = useState(0);
  const [session, setSession] = useState<0 | 1>(new Date().getHours() < 14 ? 0 : 1);
  const [animalType, setAnimalType] = useState<AnimalType>('mix');
  const [weight, setWeight] = useState('');
  const [fat, setFat] = useState('');
  const [snf, setSnf] = useState('');
  const [chart, setChart] = useState<RateEntry[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [rounding, setRounding] = useState<0 | 1 | 2>(0);
  const [societyName, setSocietyName] = useState('My Dairy');
  const [autoPrint, setAutoPrint] = useState(false);
  const [smsEnabled, setSmsEnabled] = useState(true);
  const [btPrinter, setBtPrinter] = useState('');
  const [saving, setSaving] = useState(false);
  // `locked` here is the per-session lock (AM/PM), not the subscription lock.
  const [locked, setLocked] = useState(false);
  const sessionInit = useRef(false);

  const isWalkIn = !code.trim() || code.trim() === '0';

  useEffect(() => {
    getSettings().then((st) => {
      setRounding(st.rounding);
      setSocietyName(st.societyName);
      setAutoPrint(st.autoPrintSlip);
      setSmsEnabled(st.smsOnSave);
      setBtPrinter(st.btPrinterAddress);
      if (!sessionInit.current) {
        setSession(new Date().getHours() < st.amCutoffHour ? 0 : 1);
        sessionInit.current = true;
      }
    });
  }, []);

  // Reload chart when animal type changes
  useFocusEffect(useCallback(() => { getRateChart(animalType).then((c) => setChart(c as RateEntry[])); }, [animalType]));

  const loadRecent = async () => setRecent(await recentCollections(8));

  useFocusEffect(
    useCallback(() => {
      loadRecent();
      const today = new Date().toISOString().slice(0, 10);
      isSessionLocked(today, session).then(setLocked);
    }, [session])
  );

  // resolve member name as the code is typed
  useEffect(() => {
    const c = parseInt(code, 10);
    if (!c) { setMemberName(null); setMemberMobile(null); setDeductionPct(0); return; }
    getMemberByCode(c).then((m) => {
      setMemberName(m?.name ?? null);
      setMemberMobile(m?.mobile1 ?? null);
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

  const save = async (sendSms: boolean) => {
    const c = isWalkIn ? 0 : parseInt(code, 10);
    if (c !== 0 && !memberName) return Alert.alert('Unknown member', `No member ${c}. Add them first.`);
    if (!(parseFloat(weight) > 0)) return Alert.alert('Missing', 'Enter weight');
    if (calc.rate === 0) return Alert.alert('No rate', 'No rate found for this fat. Check the rate chart.');
    if (locked) return Alert.alert('Session locked 🔒', 'This session is locked. Unlock it first to add entries.');
    if (!guard()) return;

    setSaving(true);
    const today = new Date().toISOString().slice(0, 10);
    const sessionLabel = session === 0 ? 'Morning' : 'Evening';
    const name = isWalkIn ? WALK_IN : (memberName ?? String(c));

    try {
      // Pipeline order: 1) SMS  →  2) Print  →  3) Save to DB.
      // SMS and print failures are non-fatal so the entry is still recorded.

      // 1) SMS first (registered farmers with a mobile number)
      if (sendSms && !isWalkIn && memberMobile) {
        try {
          const smsData: SlipData = {
            societyName, date: today, session: sessionLabel,
            memberName: name, membercode: c,
            weight: calc.weight, fat: calc.fat, snf: calc.snf || undefined, rate: calc.rate, amount: calc.price,
          };
          await openCollectionSms(memberMobile, smsData);
        } catch (e: any) {
          Alert.alert('SMS error', e?.message ?? String(e));
        }
      }

      // 2) Print next — Bluetooth thermal if configured, else OS print dialog
      try {
        if (btPrinter && isThermalAvailable()) {
          const r = await printCollectionSlipBT(btPrinter, {
            societyName, date: today, session: sessionLabel,
            memberName: name, membercode: c,
            weight: calc.weight, fat: calc.fat, snf: calc.snf || undefined, rate: calc.rate, amount: calc.price,
          });
          if (r.error) Alert.alert('Print error', r.error);
        } else if (autoPrint) {
          await printCollectionSlip({
            society: societyName, date: today, session: sessionLabel,
            code: c, name,
            weight: calc.weight, fat: calc.fat, snf: calc.snf, rate: calc.rate, amount: calc.price,
          });
        }
      } catch (e: any) {
        Alert.alert('Print error', e?.message ?? String(e));
      }

      // 3) Save to the local DB last
      await insertCollection({
        membercode: c,
        session,
        collect_date: today,
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
        animal_type: animalType,
      });

      // reset for next farmer, keep session
      setCode(''); setWeight(''); setFat(''); setSnf(''); setMemberName(null); setMemberMobile(null);
      await loadRecent();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const canSms = !isWalkIn && !!memberMobile && smsEnabled;

  return (
    <KeyboardAwareScreen style={styles.wrap} contentContainerStyle={{ padding: 16 }}>
      {/* Animal type selector */}
      <View style={styles.animalRow}>
        {ANIMAL_TABS.map((a) => (
          <TouchableOpacity
            key={a.type}
            style={[styles.animalSeg, animalType === a.type && { backgroundColor: a.color, borderColor: a.color }]}
            onPress={() => setAnimalType(a.type)}
          >
            <Text style={styles.animalEmoji}>{a.emoji}</Text>
            <Text style={[styles.animalLabel, animalType === a.type && { color: '#fff' }]}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.sessionRow}>
        {([[0, 'Morning'], [1, 'Evening']] as const).map(([s, lbl]) => (
          <TouchableOpacity key={s} style={[styles.seg, session === s && styles.segActive]} onPress={() => setSession(s as 0 | 1)}>
            <Text style={[styles.segText, session === s && styles.segTextActive]}>{lbl}{session === s && locked ? ' 🔒' : ''}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={[styles.lockBtn, locked ? styles.lockBtnLocked : styles.lockBtnOpen]}
          onPress={async () => {
            if (!guard()) return;
            const today = new Date().toISOString().slice(0, 10);
            if (locked) { await unlockSession(today, session); setLocked(false); }
            else {
              Alert.alert('Lock session?', `No more entries can be added to ${session === 0 ? 'Morning' : 'Evening'} today.`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Lock', style: 'destructive', onPress: async () => { await lockSession(today, session); setLocked(true); } },
              ]);
            }
          }}
        >
          <Text style={styles.lockBtnText}>{locked ? '🔓' : '🔒'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Member code (empty = Walk-in)</Text>
        <TextInput style={styles.bigInput} keyboardType="number-pad" value={code} onChangeText={setCode} placeholder="Walk-in" placeholderTextColor="#bcc" autoFocus />
        <Text style={[styles.memberName, !memberName && code ? styles.memberMissing : null]}>
          {isWalkIn ? '🚶 Walk-in customer' : (code ? (memberName ?? '⚠︎ unknown member') : ' ')}
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

      {/* Action buttons */}
      <View style={styles.actionRow}>
        {canSms ? (
          <TouchableOpacity style={[styles.btn, styles.btnSms]} onPress={() => save(true)} onLongPress={() => showHelp('Save & Send', 'सेव और भेजें', 'यह प्रविष्टि सुरक्षित करें और किसान को SMS पर्ची भेजें।', 'Save this entry and send the farmer an SMS slip.')} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>📱 Save & Send</Text>}
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={[styles.btn, canSms ? styles.btnSave : styles.btnSaveFull]} onPress={() => save(false)} onLongPress={() => showHelp('Save', 'सेव करें', 'किसान के दूध की यह प्रविष्टि सुरक्षित करें।', "Save this farmer's milk entry.")} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>{isWalkIn ? '🧾 Save & Print' : '💾 Save'}</Text>}
        </TouchableOpacity>
      </View>

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
              <Text style={styles.recentCode}>{r.membercode === 0 ? '🚶' : `#${r.membercode}`}</Text>
              <Text style={styles.recentMid}>{r.weight}L · {r.fat}%</Text>
              <Text style={styles.recentAmt}>₹{Number(r.price).toFixed(0)}</Text>
              <Text style={r.synced ? styles.dotOk : styles.dotPending}>●</Text>
            </TouchableOpacity>
          ))}
        </>
      )}
    </KeyboardAwareScreen>
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
  animalRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  animalSeg: { flex: 1, borderWidth: 2, borderColor: '#ccd', borderRadius: 10, padding: 8, alignItems: 'center', backgroundColor: '#fff' },
  animalEmoji: { fontSize: 18 },
  animalLabel: { color: '#4a5a6a', fontWeight: '700', fontSize: 11, marginTop: 2 },
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
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btn: { padding: 16, borderRadius: 12, alignItems: 'center' },
  btnSms: { flex: 1.2, backgroundColor: '#2a6fdb' },
  btnSave: { flex: 0.8, backgroundColor: '#1b9c66' },
  btnSaveFull: { flex: 1, backgroundColor: '#1b9c66' },
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
  lockBtn: { width: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  lockBtnOpen: { backgroundColor: '#e5e9ee' },
  lockBtnLocked: { backgroundColor: '#fde8e8' },
  lockBtnText: { fontSize: 18 },
});

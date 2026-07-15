import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getMemberByCode, insertLedgerEntry, recentLedgerEntries, ledgerBalance } from '../lib/db';

export default function LedgerScreen({ navigation }: any) {
  const [code, setCode] = useState('');
  const [memberName, setMemberName] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<'jama' | 'udhar'>('jama');
  const [note, setNote] = useState('');
  const [recent, setRecent] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [balance, setBalance] = useState<{ jama: number; udhar: number; net: number } | null>(null);

  const loadRecent = async () => setRecent(await recentLedgerEntries(20));
  useFocusEffect(useCallback(() => { loadRecent(); }, []));

  // resolve member
  useEffect(() => {
    const c = parseInt(code, 10);
    if (!c) { setMemberName(null); setBalance(null); return; }
    getMemberByCode(c).then((m) => setMemberName(m?.name ?? null));
    ledgerBalance(c).then(setBalance);
  }, [code]);

  const save = async () => {
    const c = parseInt(code, 10);
    if (!c) return Alert.alert('Missing', 'Enter a member code');
    if (!memberName) return Alert.alert('Unknown member', `No member ${c}. Add them first.`);
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return Alert.alert('Missing', 'Enter an amount > 0');

    setSaving(true);
    try {
      await insertLedgerEntry({ membercode: c, amount: amt, kind, note: note.trim() || undefined });
      setAmount(''); setNote(''); setCode(''); setMemberName(null); setBalance(null);
      await loadRecent();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.label}>Member code</Text>
        <TextInput style={styles.bigInput} keyboardType="number-pad" value={code} onChangeText={setCode} placeholder="000" placeholderTextColor="#bcc" autoFocus />
        <Text style={[styles.memberName, !memberName && code ? styles.memberMissing : null]}>
          {code ? (memberName ?? '⚠︎ unknown member') : ' '}
        </Text>

        {balance && (
          <View style={styles.balanceRow}>
            <View style={styles.balItem}><Text style={[styles.balVal, { color: '#1b9c66' }]}>₹{balance.jama.toFixed(0)}</Text><Text style={styles.balLbl}>Jama (credit)</Text></View>
            <View style={styles.balDivider} />
            <View style={styles.balItem}><Text style={[styles.balVal, { color: '#c0392b' }]}>₹{balance.udhar.toFixed(0)}</Text><Text style={styles.balLbl}>Udhar (debit)</Text></View>
            <View style={styles.balDivider} />
            <View style={styles.balItem}><Text style={[styles.balVal, { color: '#0d1b2a' }]}>₹{balance.net.toFixed(0)}</Text><Text style={styles.balLbl}>Net</Text></View>
          </View>
        )}

        <Text style={styles.label}>Type</Text>
        <View style={styles.kindRow}>
          <TouchableOpacity style={[styles.kindBtn, kind === 'jama' && styles.kindJama]} onPress={() => setKind('jama')}>
            <Text style={[styles.kindText, kind === 'jama' && styles.kindTextOn]}>➕ Jama (credit)</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.kindBtn, kind === 'udhar' && styles.kindUdhar]} onPress={() => setKind('udhar')}>
            <Text style={[styles.kindText, kind === 'udhar' && styles.kindTextOn]}>➖ Udhar (debit)</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>Amount ₹</Text>
        <TextInput style={styles.input} keyboardType="decimal-pad" value={amount} onChangeText={setAmount} placeholder="0" placeholderTextColor="#bcc" />

        <Text style={styles.label}>Note (optional)</Text>
        <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="Advance, feed, bonus…" placeholderTextColor="#bcc" />
      </View>

      <TouchableOpacity style={styles.btn} onPress={save} disabled={saving}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Save entry</Text>}
      </TouchableOpacity>

      {recent.length > 0 && (
        <>
          <Text style={styles.section}>Recent entries</Text>
          {recent.map((r) => (
            <View key={r.local_id} style={styles.row}>
              <View style={[styles.kindDot, { backgroundColor: r.kind === 'jama' ? '#1b9c66' : '#c0392b' }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>#{r.membercode} · {r.name ?? '—'}</Text>
                <Text style={styles.rowNote}>{r.note || r.kind} · {r.entry_date}</Text>
              </View>
              <Text style={[styles.rowAmt, { color: r.kind === 'jama' ? '#1b9c66' : '#c0392b' }]}>
                {r.kind === 'jama' ? '+' : '−'}₹{Number(r.amount).toFixed(0)}
              </Text>
              <Text style={r.synced ? styles.dotOk : styles.dotPending}>●</Text>
            </View>
          ))}
        </>
      )}
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f3f5f7' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16 },
  label: { color: '#4a5a6a', marginTop: 12, marginBottom: 6, fontWeight: '600', fontSize: 13 },
  bigInput: { borderWidth: 1, borderColor: '#dde', borderRadius: 10, padding: 12, fontSize: 30, fontWeight: '800', color: '#0d1b2a', textAlign: 'center' },
  memberName: { textAlign: 'center', marginVertical: 8, fontSize: 16, fontWeight: '700', color: '#1b9c66', minHeight: 22 },
  memberMissing: { color: '#c0392b' },
  balanceRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8f9fa', borderRadius: 10, padding: 10, marginBottom: 6 },
  balItem: { flex: 1, alignItems: 'center' },
  balDivider: { width: 1, height: 30, backgroundColor: '#e0e5ea' },
  balVal: { fontSize: 18, fontWeight: '800' },
  balLbl: { color: '#67788a', fontSize: 10, marginTop: 2 },
  kindRow: { flexDirection: 'row', gap: 10 },
  kindBtn: { flex: 1, borderWidth: 1.5, borderColor: '#dde', borderRadius: 10, padding: 12, alignItems: 'center', backgroundColor: '#fff' },
  kindJama: { backgroundColor: '#e6f9f0', borderColor: '#1b9c66' },
  kindUdhar: { backgroundColor: '#fde8e8', borderColor: '#c0392b' },
  kindText: { fontWeight: '700', color: '#4a5a6a' },
  kindTextOn: { color: '#0d1b2a' },
  input: { borderWidth: 1, borderColor: '#dde', borderRadius: 10, padding: 13, fontSize: 18, color: '#111' },
  btn: { backgroundColor: '#2a6fdb', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 17 },
  section: { fontWeight: '800', color: '#0d1b2a', marginTop: 24, marginBottom: 8, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 6, gap: 10 },
  kindDot: { width: 8, height: 8, borderRadius: 4 },
  rowName: { fontWeight: '700', color: '#0d1b2a', fontSize: 14 },
  rowNote: { color: '#67788a', fontSize: 12, marginTop: 2 },
  rowAmt: { fontWeight: '800', fontSize: 16 },
  dotOk: { color: '#1b9c66', fontSize: 12 },
  dotPending: { color: '#e08e0b', fontSize: 12 },
});

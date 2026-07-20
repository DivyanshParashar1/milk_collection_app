import React, { useCallback, useLayoutEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Linking, Modal } from 'react-native';
import KeyboardAwareScreen from '../components/KeyboardAwareScreen';
import { useFocusEffect } from '@react-navigation/native';
import {
  routineStatement,
  getRoutineCustomer,
  insertRoutinePayment,
  deleteRoutinePayment,
  RoutineStatement,
} from '../lib/db';
import { useSubscription } from '../context/SubscriptionContext';

/** 'YYYY-MM' for a date offset by `delta` months from today. */
function monthKey(delta = 0): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

export default function RoutineStatementScreen({ route, navigation }: any) {
  const { guard } = useSubscription();
  const customerId: number = route.params.customerId;

  const [customer, setCustomer] = useState<any>(null);
  const [month, setMonth] = useState(monthKey(0));
  const [data, setData] = useState<RoutineStatement | null>(null);
  const [loading, setLoading] = useState(true);

  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'cash' | 'upi'>('cash');
  const [payNote, setPayNote] = useState('');
  const [paying, setPaying] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ title: route.params?.name ?? 'Account' });
  }, [navigation, route.params?.name]);

  const load = useCallback(async () => {
    const [c, s] = await Promise.all([getRoutineCustomer(customerId), routineStatement(customerId, month)]);
    setCustomer(c);
    setData(s);
    setLoading(false);
  }, [customerId, month]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const recordPayment = async () => {
    if (!guard()) return;
    const amt = parseFloat(payAmount) || 0;
    if (!(amt > 0)) return Alert.alert('Missing', 'Enter the amount received');
    setPaying(true);
    try {
      await insertRoutinePayment({ customer_id: customerId, amount: amt, method: payMethod, note: payNote.trim() || undefined });
      setPayOpen(false);
      setPayAmount(''); setPayNote('');
      await load();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e));
    } finally {
      setPaying(false);
    }
  };

  const removePayment = (p: any) => {
    Alert.alert('Delete payment?', `₹${p.amount} on ${p.paid_on} will be removed and the balance will go back up.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (!guard()) return;
          await deleteRoutinePayment(p.local_id);
          await load();
        },
      },
    ]);
  };

  const sendBill = () => {
    if (!customer?.mobile || !data) return;
    const msg =
      `${customer.name}\n${monthLabel(month)}\n` +
      `Milk: ${data.litres.toFixed(1)} L\nAmount: Rs ${data.billed.toFixed(0)}\n` +
      `Paid: Rs ${data.paid.toFixed(0)}\nBalance due: Rs ${data.outstanding.toFixed(0)}`;
    Linking.openURL(`sms:${customer.mobile}?body=${encodeURIComponent(msg)}`).catch(() => {
      Alert.alert('Could not open messages');
    });
  };

  if (loading || !data) {
    return <View style={styles.center}><ActivityIndicator color="#00897b" size="large" /></View>;
  }

  return (
    <KeyboardAwareScreen style={styles.wrap} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      {/* Month stepper */}
      <View style={styles.monthRow}>
        <TouchableOpacity style={styles.monthBtn} onPress={() => setMonth(shiftMonth(month, -1))}>
          <Text style={styles.monthBtnText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.monthText}>{monthLabel(month)}</Text>
        <TouchableOpacity
          style={[styles.monthBtn, month >= monthKey(0) && styles.monthBtnOff]}
          onPress={() => month < monthKey(0) && setMonth(shiftMonth(month, 1))}
        >
          <Text style={styles.monthBtnText}>›</Text>
        </TouchableOpacity>
      </View>

      {/* This month */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>This month</Text>
        <View style={styles.gridRow}>
          <View style={styles.gridItem}><Text style={styles.gridVal}>{data.deliveries.length}</Text><Text style={styles.gridLbl}>deliveries</Text></View>
          <View style={styles.gridItem}><Text style={styles.gridVal}>{data.litres.toFixed(1)}</Text><Text style={styles.gridLbl}>litres</Text></View>
          <View style={styles.gridItem}><Text style={styles.gridVal}>₹{data.billed.toFixed(0)}</Text><Text style={styles.gridLbl}>billed</Text></View>
          <View style={styles.gridItem}><Text style={[styles.gridVal, { color: '#1b9c66' }]}>₹{data.paid.toFixed(0)}</Text><Text style={styles.gridLbl}>paid</Text></View>
        </View>
      </View>

      {/* Balance is lifetime, not monthly — see routineStatement() */}
      <View style={[styles.balanceCard, data.outstanding > 0 ? styles.balanceOwed : styles.balanceClear]}>
        <Text style={styles.balanceLbl}>
          {data.outstanding > 0 ? 'Total outstanding' : data.outstanding < 0 ? 'Advance paid' : 'All settled'}
        </Text>
        <Text style={styles.balanceVal}>₹{Math.abs(data.outstanding).toFixed(0)}</Text>
        <Text style={styles.balanceHint}>across all months, not just this one</Text>
      </View>

      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.payBtn} onPress={() => { setPayAmount(data.outstanding > 0 ? String(Math.round(data.outstanding)) : ''); setPayOpen(true); }}>
          <Text style={styles.payBtnText}>💵 Record payment</Text>
        </TouchableOpacity>
        {!!customer?.mobile && (
          <TouchableOpacity style={styles.smsBtn} onPress={sendBill}>
            <Text style={styles.smsBtnText}>📩 Send bill</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Payments this month */}
      {data.payments.length > 0 && (
        <>
          <Text style={styles.section}>Payments received</Text>
          {data.payments.map((p) => (
            <TouchableOpacity key={p.local_id} style={styles.payRow} onLongPress={() => removePayment(p)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.payRowAmt}>₹{Number(p.amount).toFixed(0)}</Text>
                <Text style={styles.payRowSub}>{p.paid_on} · {p.method}{p.note ? ` · ${p.note}` : ''}</Text>
              </View>
              <Text style={p.synced ? styles.dotOk : styles.dotPending}>●</Text>
            </TouchableOpacity>
          ))}
          <Text style={styles.hint}>Long-press a payment to delete it.</Text>
        </>
      )}

      {/* Delivery log */}
      <Text style={styles.section}>Deliveries</Text>
      {data.deliveries.length === 0 ? (
        <Text style={styles.hint}>No deliveries recorded in {monthLabel(month)}.</Text>
      ) : (
        data.deliveries.map((d) => (
          <View key={d.local_id} style={styles.dRow}>
            <Text style={styles.dDate}>{d.delivery_date.slice(8)}/{d.delivery_date.slice(5, 7)}</Text>
            <Text style={styles.dSession}>{d.session === 0 ? 'AM' : 'PM'}</Text>
            <Text style={styles.dQty}>{d.quantity} L</Text>
            <Text style={styles.dRate}>× ₹{d.rate}</Text>
            <Text style={styles.dAmt}>₹{Number(d.amount).toFixed(0)}</Text>
            <Text style={d.synced ? styles.dotOk : styles.dotPending}>●</Text>
          </View>
        ))
      )}

      <TouchableOpacity style={styles.link} onPress={() => navigation.navigate('RoutineCustomerForm', { customerId })}>
        <Text style={styles.linkText}>✏️ Edit customer</Text>
      </TouchableOpacity>
      <View style={{ height: 40 }} />

      {/* Payment sheet */}
      <Modal visible={payOpen} transparent animationType="slide" onRequestClose={() => setPayOpen(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Payment received</Text>

            <Text style={styles.label}>Amount ₹</Text>
            <TextInput style={styles.modalInput} keyboardType="decimal-pad" value={payAmount} onChangeText={setPayAmount} placeholder="0" placeholderTextColor="#bcc" autoFocus />

            <Text style={styles.label}>Method</Text>
            <View style={styles.methodRow}>
              {([['cash', '💵 Cash'], ['upi', '📱 UPI']] as const).map(([m, lbl]) => (
                <TouchableOpacity key={m} style={[styles.methodSeg, payMethod === m && styles.methodSegOn]} onPress={() => setPayMethod(m)}>
                  <Text style={[styles.methodText, payMethod === m && styles.methodTextOn]}>{lbl}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Note (optional)</Text>
            <TextInput style={styles.modalInput} value={payNote} onChangeText={setPayNote} placeholder="Ref, part payment…" placeholderTextColor="#bcc" />

            <TouchableOpacity style={styles.modalSave} onPress={recordPayment} disabled={paying}>
              {paying ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalSaveText}>Save payment</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalCancel} onPress={() => setPayOpen(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAwareScreen>
  );
}

/** Step a 'YYYY-MM' key by whole months, rolling the year over correctly. */
function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f3f5f7' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f5f7' },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  monthBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  monthBtnOff: { opacity: 0.3 },
  monthBtnText: { fontSize: 24, color: '#00897b', fontWeight: '800', lineHeight: 28 },
  monthText: { fontWeight: '800', fontSize: 17, color: '#0d1b2a' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12 },
  cardTitle: { fontWeight: '800', fontSize: 14, color: '#0d1b2a', marginBottom: 12 },
  gridRow: { flexDirection: 'row' },
  gridItem: { flex: 1, alignItems: 'center' },
  gridVal: { fontWeight: '800', fontSize: 18, color: '#0d1b2a' },
  gridLbl: { color: '#8a97a6', fontSize: 10, marginTop: 3 },
  balanceCard: { borderRadius: 16, padding: 20, alignItems: 'center', marginBottom: 12 },
  balanceOwed: { backgroundColor: '#d63031' },
  balanceClear: { backgroundColor: '#1b9c66' },
  balanceLbl: { color: '#fff', fontSize: 13, opacity: 0.9, fontWeight: '600' },
  balanceVal: { color: '#fff', fontSize: 38, fontWeight: '800', marginTop: 4 },
  balanceHint: { color: '#fff', fontSize: 11, opacity: 0.75, marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 10 },
  payBtn: { flex: 1, backgroundColor: '#00897b', padding: 15, borderRadius: 12, alignItems: 'center' },
  payBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  smsBtn: { flex: 1, backgroundColor: '#2a6fdb', padding: 15, borderRadius: 12, alignItems: 'center' },
  smsBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  section: { fontWeight: '800', color: '#0d1b2a', marginTop: 24, marginBottom: 8, fontSize: 15 },
  hint: { color: '#8a97a6', fontSize: 12, marginTop: 6 },
  payRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 6, gap: 10 },
  payRowAmt: { fontWeight: '800', color: '#1b9c66', fontSize: 16 },
  payRowSub: { color: '#67788a', fontSize: 12, marginTop: 2 },
  dRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 5, gap: 8 },
  dDate: { color: '#0d1b2a', fontWeight: '700', fontSize: 13, width: 46 },
  dSession: { color: '#8a97a6', fontSize: 11, width: 24 },
  dQty: { color: '#0d1b2a', fontSize: 13, fontWeight: '600', width: 50 },
  dRate: { color: '#8a97a6', fontSize: 12, flex: 1 },
  dAmt: { color: '#0d1b2a', fontWeight: '800', fontSize: 14 },
  dotOk: { color: '#1b9c66', fontSize: 11 },
  dotPending: { color: '#e08e0b', fontSize: 11 },
  link: { alignItems: 'center', marginTop: 20 },
  linkText: { color: '#2a6fdb', fontWeight: '700', fontSize: 14 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalTitle: { fontWeight: '800', fontSize: 18, color: '#0d1b2a', marginBottom: 6 },
  label: { color: '#4a5a6a', marginTop: 12, marginBottom: 6, fontWeight: '600', fontSize: 13 },
  modalInput: { borderWidth: 1, borderColor: '#dde', borderRadius: 10, padding: 13, fontSize: 17, color: '#111' },
  methodRow: { flexDirection: 'row', gap: 8 },
  methodSeg: { flex: 1, borderWidth: 1, borderColor: '#dde', borderRadius: 10, padding: 12, alignItems: 'center' },
  methodSegOn: { backgroundColor: '#00897b', borderColor: '#00897b' },
  methodText: { color: '#4a5a6a', fontWeight: '700' },
  methodTextOn: { color: '#fff' },
  modalSave: { backgroundColor: '#00897b', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 18 },
  modalSaveText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  modalCancel: { padding: 14, alignItems: 'center' },
  modalCancelText: { color: '#8a97a6', fontWeight: '700' },
});

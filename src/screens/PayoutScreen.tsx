import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { getMemberByCode, farmerBalance, insertPayout } from '../lib/db';
import { openUpiPayment, isValidVpa, isValidMobile, phoneToVpa } from '../lib/upi';
import { getSettings } from '../lib/settings';

export default function PayoutScreen({ route }: any) {
  const [code, setCode] = useState(route?.params?.membercode ? String(route.params.membercode) : '');
  const [member, setMember] = useState<any | null>(null);
  const [balance, setBalance] = useState(0);
  const [amount, setAmount] = useState('');
  const [upiId, setUpiId] = useState('');
  const [upiSource, setUpiSource] = useState<'id' | 'mobile' | 'none'>('none');
  const [upiHandle, setUpiHandle] = useState('upi');
  const [busy, setBusy] = useState(false);

  useEffect(() => { getSettings().then((st) => setUpiHandle(st.upiHandle)); }, []);

  // resolve farmer as the code is typed
  useEffect(() => {
    const c = parseInt(code, 10);
    if (!c) { setMember(null); setBalance(0); setAmount(''); setUpiId(''); setUpiSource('none'); return; }
    (async () => {
      const m = await getMemberByCode(c);
      setMember(m ?? null);
      if (m?.upi_id) {
        setUpiId(m.upi_id);            // farmer has a real UPI id → use it
        setUpiSource('id');
      } else if (m?.mobile1 && isValidMobile(m.mobile1)) {
        setUpiId(phoneToVpa(m.mobile1, upiHandle)); // no UPI id → derive from mobile number
        setUpiSource('mobile');
      } else {
        setUpiId('');
        setUpiSource('none');
      }
      if (m) {
        const bal = await farmerBalance(c);
        setBalance(bal);
        setAmount(bal > 0 ? String(Math.round(bal)) : '');
      }
    })();
  }, [code, upiHandle]);

  const recordPayout = async (method: 'cash' | 'upi', upiRef?: string) => {
    const amt = parseFloat(amount);
    await insertPayout({ membercode: member.membercode, amount: amt, method, upi_ref: upiRef });
    const newBal = await farmerBalance(member.membercode);
    setBalance(newBal);
    setAmount(newBal > 0 ? String(Math.round(newBal)) : '');
    Alert.alert('✅ Paid', `₹${amt.toFixed(0)} paid to ${member.name} by ${method === 'cash' ? 'cash' : 'UPI'}.`);
  };

  const payCash = () => {
    const amt = parseFloat(amount);
    if (!member) return Alert.alert('Farmer', 'Enter a valid member code');
    if (!(amt > 0)) return Alert.alert('Amount', 'Enter an amount');
    Alert.alert('Pay by cash?', `₹${amt.toFixed(0)} to ${member.name}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Yes, paid', onPress: () => recordPayout('cash') },
    ]);
  };

  const payUpi = async () => {
    const amt = parseFloat(amount);
    if (!member) return Alert.alert('Farmer', 'Enter a valid member code');
    if (!(amt > 0)) return Alert.alert('Amount', 'Enter an amount');
    if (!isValidVpa(upiId)) return Alert.alert('UPI id needed', 'Enter the farmer\'s UPI id (e.g. 98765xxxxx@ybl)');

    setBusy(true);
    const opened = await openUpiPayment({ vpa: upiId, name: member.name, amount: amt, note: `Milk ${member.membercode}` });
    setBusy(false);

    if (!opened) {
      Alert.alert('No UPI app', 'Could not open a UPI app on this device. Use a phone with GPay / PhonePe / Paytm installed.');
      return;
    }
    // UPI intent doesn't report back to the app — confirm with the operator.
    setTimeout(() => {
      Alert.alert('Did the UPI payment succeed?', `₹${amt.toFixed(0)} to ${member.name}`, [
        { text: 'No / cancelled', style: 'cancel' },
        { text: 'Yes, paid', onPress: () => recordPayout('upi', upiId) },
      ]);
    }, 600);
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>Farmer code / किसान नंबर</Text>
      <TextInput style={styles.bigInput} keyboardType="number-pad" value={code} onChangeText={setCode} placeholder="000" placeholderTextColor="#bcc" autoFocus />

      {member ? (
        <View style={styles.memberCard}>
          <Text style={styles.memberName}>{member.name}</Text>
          <Text style={styles.balanceLabel}>Balance to pay / बकाया</Text>
          <Text style={styles.balanceValue}>₹{balance.toFixed(0)}</Text>
        </View>
      ) : code ? (
        <Text style={styles.missing}>⚠︎ No farmer with this code</Text>
      ) : null}

      {member && (
        <>
          <Text style={styles.label}>Amount / राशि (₹)</Text>
          <TextInput style={styles.amountInput} keyboardType="decimal-pad" value={amount} onChangeText={setAmount} placeholder="0" placeholderTextColor="#bcc" />

          <Text style={styles.label}>Farmer UPI id (for UPI payment)</Text>
          <TextInput style={styles.input} autoCapitalize="none" value={upiId}
            onChangeText={(t) => { setUpiId(t); setUpiSource('id'); }}
            placeholder="98765xxxxx@ybl" placeholderTextColor="#9aa" />
          {upiSource === 'mobile' && (
            <Text style={styles.upiHint}>↳ from mobile number — check the part after “@” is right</Text>
          )}
          {upiSource === 'none' && (
            <Text style={styles.upiHintWarn}>No UPI id or mobile on file — enter a UPI id, or pay by cash</Text>
          )}

          <View style={styles.btnRow}>
            <TouchableOpacity style={[styles.payBtn, styles.cashBtn]} onPress={payCash} disabled={busy}>
              <Text style={styles.payIcon}>💵</Text>
              <Text style={styles.payText}>CASH</Text>
              <Text style={styles.paySub}>नकद</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.payBtn, styles.upiBtn]} onPress={payUpi} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.payIcon}>📱</Text>}
              <Text style={styles.payText}>UPI</Text>
              <Text style={styles.paySub}>यूपीआई</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f3f5f7' },
  label: { color: '#4a5a6a', marginBottom: 6, marginTop: 14, fontWeight: '700', fontSize: 15 },
  bigInput: { backgroundColor: '#fff', borderWidth: 2, borderColor: '#dde', borderRadius: 12, padding: 14, fontSize: 34, fontWeight: '800', color: '#0d1b2a', textAlign: 'center' },
  memberCard: { backgroundColor: '#0d1b2a', borderRadius: 16, padding: 20, marginTop: 16, alignItems: 'center' },
  memberName: { color: '#fff', fontSize: 24, fontWeight: '800' },
  balanceLabel: { color: '#8fb', marginTop: 10, fontSize: 14 },
  balanceValue: { color: '#43e08e', fontSize: 40, fontWeight: '900', marginTop: 2 },
  missing: { color: '#c0392b', fontWeight: '700', marginTop: 16, textAlign: 'center', fontSize: 16 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#dde', borderRadius: 10, padding: 14, fontSize: 16, color: '#111' },
  upiHint: { color: '#2a6fdb', marginTop: 6, fontSize: 13 },
  upiHintWarn: { color: '#c0392b', marginTop: 6, fontSize: 13 },
  amountInput: { backgroundColor: '#fff', borderWidth: 2, borderColor: '#1b9c66', borderRadius: 12, padding: 12, fontSize: 32, fontWeight: '800', color: '#0d1b2a', textAlign: 'center' },
  btnRow: { flexDirection: 'row', gap: 14, marginTop: 22 },
  payBtn: { flex: 1, borderRadius: 18, paddingVertical: 24, alignItems: 'center' },
  cashBtn: { backgroundColor: '#1b9c66' },
  upiBtn: { backgroundColor: '#2a6fdb' },
  payIcon: { fontSize: 44 },
  payText: { color: '#fff', fontWeight: '900', fontSize: 22, marginTop: 6, letterSpacing: 1 },
  paySub: { color: '#e8f5ee', fontSize: 15, marginTop: 2 },
});

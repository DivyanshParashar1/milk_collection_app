import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, ScrollView, Linking, AppState } from 'react-native';
import { getPayConfig, buildUpiUrl, raiseSubscriptionRequest, PayConfig, DEFAULT_VPA, DEFAULT_PAYEE } from '../lib/upiPay';

const PLANS = [
  { id: 'monthly', label: 'Monthly', sub: '1 month', price: 199 },
  { id: 'yearly', label: 'Yearly', sub: '12 months · save 16%', price: 1999 },
];

export default function SubscriptionScreen() {
  const [plan, setPlan] = useState(PLANS[0]);
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState<PayConfig>({ vpa: DEFAULT_VPA, payeeName: DEFAULT_PAYEE });
  const [requested, setRequested] = useState(false);
  const openedRef = useRef(false);

  useEffect(() => { getPayConfig().then(setCfg); }, []);

  // UPI apps return to us when done. On resume (if we launched one), ask to confirm.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && openedRef.current) {
        openedRef.current = false;
        confirmPaid();
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, cfg]);

  const payViaUpi = async () => {
    const url = buildUpiUrl(cfg, plan.price, `MilkApp ${plan.label} subscription`);
    openedRef.current = true;
    try {
      await Linking.openURL(url);
    } catch {
      openedRef.current = false;
      Alert.alert(
        'No UPI app found',
        `Please pay ₹${plan.price} to this UPI ID:\n\n${cfg.vpa}\n\nThen tap "I have already paid".`
      );
    }
  };

  const confirmPaid = () => {
    Alert.alert(
      'Payment complete?',
      `Did you finish paying ₹${plan.price} to ${cfg.vpa}?`,
      [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Yes, I paid', onPress: sendRequest },
      ]
    );
  };

  const sendRequest = async () => {
    setBusy(true);
    const r = await raiseSubscriptionRequest(plan, `UPI ₹${plan.price} → ${cfg.vpa}`);
    setBusy(false);
    if (r.error) return Alert.alert('Could not send request', r.error);
    setRequested(true);
    Alert.alert(
      'Request sent ✓',
      'We have notified the admin. Your subscription will be activated shortly once they confirm your payment.'
    );
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.title}>App Subscription</Text>
      <Text style={styles.subtitle}>Unlock the app for your dairy. Pay by UPI, then the admin activates your account.</Text>

      {requested && (
        <View style={styles.pending}>
          <Text style={styles.pendingTitle}>⏳ Activation pending</Text>
          <Text style={styles.pendingText}>Your payment request was sent to the admin. You'll be unlocked once they confirm it.</Text>
        </View>
      )}

      {PLANS.map((p) => (
        <TouchableOpacity key={p.id} style={[styles.planCard, plan.id === p.id && styles.planActive]} onPress={() => setPlan(p)}>
          <View style={{ flex: 1 }}>
            <Text style={styles.planLabel}>{p.label}</Text>
            <Text style={styles.planSub}>{p.sub}</Text>
          </View>
          <Text style={styles.planPrice}>₹{p.price}</Text>
          <View style={[styles.radio, plan.id === p.id && styles.radioOn]} />
        </TouchableOpacity>
      ))}

      <TouchableOpacity style={styles.btn} onPress={payViaUpi} disabled={busy}>
        <Text style={styles.btnText}>Pay ₹{plan.price} via UPI</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.paidBtn} onPress={confirmPaid} disabled={busy}>
        {busy ? <ActivityIndicator color="#1b9c66" /> : <Text style={styles.paidText}>✅  I have already paid</Text>}
      </TouchableOpacity>

      <View style={styles.payToBox}>
        <Text style={styles.payToLabel}>Pay to UPI ID</Text>
        <Text selectable style={styles.payToVpa}>{cfg.vpa}</Text>
      </View>

      <Text style={styles.hint}>
        How it works: tap “Pay via UPI”, complete the payment in your UPI app, then confirm here. The admin verifies it and unlocks your dairy.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f3f5f7' },
  title: { fontSize: 24, fontWeight: '800', color: '#0d1b2a' },
  subtitle: { color: '#67788a', marginTop: 6, marginBottom: 18, fontSize: 14 },
  pending: { backgroundColor: '#fff6d9', borderRadius: 12, padding: 14, marginBottom: 16 },
  pendingTitle: { fontWeight: '800', color: '#8a6d1b', fontSize: 15 },
  pendingText: { color: '#8a6d1b', fontSize: 13, marginTop: 4 },
  planCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 18, marginBottom: 12, borderWidth: 2, borderColor: '#fff' },
  planActive: { borderColor: '#1b9c66' },
  planLabel: { fontSize: 18, fontWeight: '800', color: '#0d1b2a' },
  planSub: { color: '#67788a', marginTop: 2, fontSize: 13 },
  planPrice: { fontSize: 22, fontWeight: '800', color: '#1b9c66', marginRight: 12 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#ccd' },
  radioOn: { borderColor: '#1b9c66', backgroundColor: '#1b9c66' },
  btn: { backgroundColor: '#1b9c66', padding: 18, borderRadius: 14, alignItems: 'center', marginTop: 8 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 18 },
  paidBtn: { backgroundColor: '#fff', borderWidth: 2, borderColor: '#1b9c66', padding: 16, borderRadius: 14, alignItems: 'center', marginTop: 12 },
  paidText: { color: '#1b9c66', fontWeight: '800', fontSize: 16 },
  payToBox: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginTop: 16, alignItems: 'center' },
  payToLabel: { color: '#67788a', fontSize: 12 },
  payToVpa: { color: '#0d1b2a', fontSize: 18, fontWeight: '800', marginTop: 4 },
  hint: { color: '#67788a', padding: 12, fontSize: 13, marginTop: 8, lineHeight: 18 },
});

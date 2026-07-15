import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, ScrollView, Platform } from 'react-native';
import { supabase } from '../lib/supabase';
// Native module — present only in a dev-client / release build, not Expo Go.
let RazorpayCheckout: any = null;
try { RazorpayCheckout = require('react-native-razorpay').default; } catch { /* not linked in Expo Go */ }

const PLANS = [
  { id: 'monthly', label: 'Monthly', sub: '1 month', price: 199 },
  { id: 'yearly', label: 'Yearly', sub: '12 months · save 16%', price: 1999 },
];

export default function SubscriptionScreen() {
  const [plan, setPlan] = useState(PLANS[0]);
  const [busy, setBusy] = useState(false);

  const subscribe = async () => {
    setBusy(true);
    try {
      // 1) create the Razorpay order server-side (secret stays in the Edge Function)
      const { data, error } = await supabase.functions.invoke('razorpay-order', {
        body: { amount: plan.price, receipt: `sub_${plan.id}_${Date.now()}`, notes: { purpose: 'subscription', plan: plan.id } },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      // record the pending subscription
      const { data: userData } = await supabase.auth.getUser();
      const { data: prof } = await supabase.from('profiles').select('society_id').eq('id', userData.user!.id).single();
      const societyId = prof?.society_id;
      if (societyId) {
        await supabase.from('payments').insert({
          society_id: societyId,
          amount: plan.price,
          purpose: 'subscription',
          plan: plan.id,
          razorpay_order_id: data.orderId,
          status: 'created',
        });
      }

      if (!RazorpayCheckout) {
        Alert.alert('Order created ✓', `Subscription order for ₹${plan.price} created.\n\nThe checkout popup needs a dev-client build (not Expo Go): npx expo run:android`);
        return;
      }

      // 2) open checkout
      const result = await RazorpayCheckout.open({
        key: data.keyId,
        order_id: data.orderId,
        amount: data.amount,
        currency: data.currency,
        name: 'MilkApp',
        description: `${plan.label} subscription`,
        theme: { color: '#8a3ffc' },
      });

      // 3) mark paid
      await supabase.from('payments').update({ status: 'paid', razorpay_payment_id: result.razorpay_payment_id }).eq('razorpay_order_id', data.orderId);
      Alert.alert('Subscribed ✓', `Payment ID: ${result.razorpay_payment_id}`);
    } catch (e: any) {
      Alert.alert('Payment cancelled / failed', e?.description || e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.title}>App Subscription</Text>
      <Text style={styles.subtitle}>Unlock the app for your dairy. Pay securely with Razorpay (UPI / card / netbanking).</Text>

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

      <TouchableOpacity style={styles.btn} onPress={subscribe} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Subscribe · ₹{plan.price}</Text>}
      </TouchableOpacity>

      {!RazorpayCheckout && (
        <Text style={styles.hint}>
          Running in Expo Go: order creation works, but the Razorpay checkout popup needs a dev-client build ({Platform.OS === 'ios' ? 'npx expo run:ios' : 'npx expo run:android'}).
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f3f5f7' },
  title: { fontSize: 24, fontWeight: '800', color: '#0d1b2a' },
  subtitle: { color: '#67788a', marginTop: 6, marginBottom: 18, fontSize: 14 },
  planCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 18, marginBottom: 12, borderWidth: 2, borderColor: '#fff' },
  planActive: { borderColor: '#8a3ffc' },
  planLabel: { fontSize: 18, fontWeight: '800', color: '#0d1b2a' },
  planSub: { color: '#67788a', marginTop: 2, fontSize: 13 },
  planPrice: { fontSize: 22, fontWeight: '800', color: '#8a3ffc', marginRight: 12 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#ccd' },
  radioOn: { borderColor: '#8a3ffc', backgroundColor: '#8a3ffc' },
  btn: { backgroundColor: '#8a3ffc', padding: 18, borderRadius: 14, alignItems: 'center', marginTop: 8 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 18 },
  hint: { color: '#8a6d1b', backgroundColor: '#fff6d9', padding: 12, borderRadius: 10, marginTop: 16, fontSize: 13 },
});

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { insertLocalSale, recentLocalSales, todayLocalSaleTotals, getLocalSaleRates } from '../lib/db';

const MILK_TYPES = ['cow', 'buff', 'mix'] as const;

export default function LocalSalesScreen({ navigation }: any) {
  const [customer, setCustomer] = useState('');
  const [quantity, setQuantity] = useState('');
  const [rate, setRate] = useState('');
  const [milkType, setMilkType] = useState<string>('mix');
  const [recent, setRecent] = useState<any[]>([]);
  const [totals, setTotals] = useState({ quantity: 0, amount: 0, count: 0 });
  const [saving, setSaving] = useState(false);
  const [rates, setRates] = useState<Map<string, number>>(new Map());

  const loadRecent = async () => {
    setRecent(await recentLocalSales(15));
    setTotals(await todayLocalSaleTotals());
  };

  useFocusEffect(useCallback(() => {
    loadRecent();
    getLocalSaleRates().then((r) => {
      const m = new Map(r.map((x) => [x.milk_type, x.rate_per_litre]));
      setRates(m);
      // auto-fill rate if not already typed
      if (!rate) {
        const defaultRate = m.get('mix') ?? m.values().next().value;
        if (defaultRate) setRate(String(defaultRate));
      }
    });
  }, []));

  // Auto-update rate when milk type changes
  useEffect(() => {
    const r = rates.get(milkType);
    if (r) setRate(String(r));
  }, [milkType, rates]);

  const computedAmount = (parseFloat(quantity) || 0) * (parseFloat(rate) || 0);

  const save = async () => {
    const qty = parseFloat(quantity);
    const r = parseFloat(rate);
    if (!qty || qty <= 0) return Alert.alert('Missing', 'Enter quantity');
    if (!r || r <= 0) return Alert.alert('Missing', 'Enter rate');

    setSaving(true);
    try {
      await insertLocalSale({
        customer_name: customer.trim() || undefined,
        quantity: qty,
        rate: r,
        amount: Math.round(qty * r * 100) / 100,
        milk_type: milkType,
      });
      setCustomer(''); setQuantity('');
      await loadRecent();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      {/* Today totals */}
      <View style={styles.statsRow}>
        <View style={styles.stat}><Text style={styles.statVal}>{totals.quantity.toFixed(1)}</Text><Text style={styles.statLbl}>Litres today</Text></View>
        <View style={styles.stat}><Text style={styles.statVal}>₹{totals.amount.toFixed(0)}</Text><Text style={styles.statLbl}>Amount</Text></View>
        <View style={styles.stat}><Text style={styles.statVal}>{totals.count}</Text><Text style={styles.statLbl}>Sales</Text></View>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Customer name (optional)</Text>
        <TextInput style={styles.input} value={customer} onChangeText={setCustomer} placeholder="Walk-in / Name" placeholderTextColor="#bcc" />

        <Text style={styles.label}>Milk type</Text>
        <View style={styles.typeRow}>
          {MILK_TYPES.map((t) => (
            <TouchableOpacity key={t} style={[styles.typeSeg, milkType === t && styles.typeSegOn]} onPress={() => setMilkType(t)}>
              <Text style={[styles.typeText, milkType === t && styles.typeTextOn]}>
                {t === 'cow' ? '🐄 Cow' : t === 'buff' ? '🐃 Buffalo' : '🥛 Mix'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Quantity (L)</Text>
            <TextInput style={styles.input} keyboardType="decimal-pad" value={quantity} onChangeText={setQuantity} placeholder="0.0" placeholderTextColor="#bcc" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Rate ₹/L</Text>
            <TextInput style={styles.input} keyboardType="decimal-pad" value={rate} onChangeText={setRate} placeholder="0" placeholderTextColor="#bcc" />
          </View>
        </View>

        <View style={styles.amtBar}>
          <Text style={styles.amtLabel}>Amount</Text>
          <Text style={styles.amtVal}>₹{computedAmount.toFixed(2)}</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.btn} onPress={save} disabled={saving}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Save sale</Text>}
      </TouchableOpacity>

      <TouchableOpacity style={styles.rateLink} onPress={() => navigation.navigate('LocalSaleRate')}>
        <Text style={styles.rateLinkText}>📋 Edit sale rates</Text>
      </TouchableOpacity>

      {recent.length > 0 && (
        <>
          <Text style={styles.section}>Recent sales</Text>
          {recent.map((r) => (
            <View key={r.local_id} style={styles.saleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.saleName}>{r.customer_name || 'Walk-in'}</Text>
                <Text style={styles.saleDetail}>{r.quantity}L × ₹{r.rate} · {r.milk_type} · {r.sale_date}</Text>
              </View>
              <Text style={styles.saleAmt}>₹{Number(r.amount).toFixed(0)}</Text>
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
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  stat: { flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 14, alignItems: 'center' },
  statVal: { fontSize: 22, fontWeight: '800', color: '#e0821b' },
  statLbl: { color: '#67788a', marginTop: 4, fontSize: 11 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16 },
  label: { color: '#4a5a6a', marginTop: 10, marginBottom: 6, fontWeight: '600', fontSize: 13 },
  input: { borderWidth: 1, borderColor: '#dde', borderRadius: 10, padding: 13, fontSize: 16, color: '#111' },
  typeRow: { flexDirection: 'row', gap: 8 },
  typeSeg: { flex: 1, borderWidth: 1, borderColor: '#dde', borderRadius: 10, padding: 10, alignItems: 'center', backgroundColor: '#fff' },
  typeSegOn: { backgroundColor: '#e0821b', borderColor: '#e0821b' },
  typeText: { color: '#4a5a6a', fontWeight: '700', fontSize: 13 },
  typeTextOn: { color: '#fff' },
  row2: { flexDirection: 'row', gap: 10 },
  amtBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0d1b2a', borderRadius: 12, padding: 16, marginTop: 14 },
  amtLabel: { color: '#8fb', fontSize: 16 },
  amtVal: { color: '#43e08e', fontSize: 28, fontWeight: '800' },
  btn: { backgroundColor: '#e0821b', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 17 },
  rateLink: { alignItems: 'center', marginTop: 12 },
  rateLinkText: { color: '#2a6fdb', fontWeight: '700', fontSize: 14 },
  section: { fontWeight: '800', color: '#0d1b2a', marginTop: 24, marginBottom: 8, fontSize: 15 },
  saleRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 6, gap: 10 },
  saleName: { fontWeight: '700', color: '#0d1b2a', fontSize: 14 },
  saleDetail: { color: '#67788a', fontSize: 12, marginTop: 2 },
  saleAmt: { fontWeight: '800', fontSize: 16, color: '#e0821b' },
  dotOk: { color: '#1b9c66', fontSize: 12 },
  dotPending: { color: '#e08e0b', fontSize: 12 },
});

import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Switch, ActivityIndicator } from 'react-native';
import KeyboardAwareScreen from '../components/KeyboardAwareScreen';
import {
  getRoutineCustomer,
  insertRoutineCustomer,
  updateRoutineCustomer,
  setRoutineCustomerActive,
  getLocalSaleRates,
} from '../lib/db';
import { useSubscription } from '../context/SubscriptionContext';

const MILK_TYPES = ['cow', 'buff', 'mix'] as const;

export default function RoutineCustomerFormScreen({ route, navigation }: any) {
  const { guard } = useSubscription();
  const customerId: number | undefined = route.params?.customerId;
  const isEdit = customerId != null;

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [address, setAddress] = useState('');
  const [milkType, setMilkType] = useState<string>('mix');
  const [rate, setRate] = useState('');
  const [active, setActive] = useState(true);

  // Morning and evening are configured independently: plenty of customers take
  // milk only in the morning, and plenty take a different amount at night.
  const [amOn, setAmOn] = useState(true);
  const [amQty, setAmQty] = useState('1');
  const [pmOn, setPmOn] = useState(false);
  const [pmQty, setPmQty] = useState('');

  const [defaultRate, setDefaultRate] = useState(0);

  useEffect(() => {
    getLocalSaleRates().then((rows) => {
      const m = new Map(rows.map((r) => [r.milk_type, r.rate_per_litre]));
      setDefaultRate(m.get(milkType) ?? 0);
    });
  }, [milkType]);

  useEffect(() => {
    if (!isEdit) return;
    getRoutineCustomer(customerId!).then((c: any) => {
      if (c) {
        setName(c.name ?? '');
        setMobile(c.mobile ?? '');
        setAddress(c.address ?? '');
        setMilkType(c.milk_type ?? 'mix');
        setRate(c.rate > 0 ? String(c.rate) : '');
        setAmOn(!!c.am_active);
        setAmQty(String(c.am_qty ?? 0));
        setPmOn(!!c.pm_active);
        setPmQty(c.pm_qty > 0 ? String(c.pm_qty) : '');
        setActive(!!c.active);
      }
      setLoading(false);
    });
  }, [customerId, isEdit]);

  const rateNum = parseFloat(rate) || 0;
  const effectiveRate = rateNum > 0 ? rateNum : defaultRate;
  const amQtyNum = parseFloat(amQty) || 0;
  const pmQtyNum = parseFloat(pmQty) || 0;
  const dailyLitres = (amOn ? amQtyNum : 0) + (pmOn ? pmQtyNum : 0);

  const save = async () => {
    if (!guard()) return;
    if (!name.trim()) return Alert.alert('Missing', 'Enter the customer name');
    if (!amOn && !pmOn) return Alert.alert('Missing', 'Turn on morning or evening delivery');
    if (amOn && !(amQtyNum > 0)) return Alert.alert('Missing', 'Enter the morning quantity');
    if (pmOn && !(pmQtyNum > 0)) return Alert.alert('Missing', 'Enter the evening quantity');

    const payload = {
      name: name.trim(),
      mobile: mobile.trim() || undefined,
      address: address.trim() || undefined,
      milk_type: milkType,
      rate: rateNum,
      am_active: amOn ? 1 : 0,
      am_qty: amOn ? amQtyNum : 0,
      pm_active: pmOn ? 1 : 0,
      pm_qty: pmOn ? pmQtyNum : 0,
      active: active ? 1 : 0,
    };

    setSaving(true);
    try {
      if (isEdit) await updateRoutineCustomer(customerId!, payload);
      else await insertRoutineCustomer(payload);
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const stopDelivery = () => {
    Alert.alert(
      'Stop delivery?',
      `${name} will be removed from the daily checklist. Their past deliveries and balance are kept.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop',
          style: 'destructive',
          onPress: async () => {
            if (!guard()) return;
            await setRoutineCustomerActive(customerId!, false);
            navigation.goBack();
          },
        },
      ]
    );
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color="#00897b" size="large" /></View>;
  }

  return (
    <KeyboardAwareScreen style={styles.wrap} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.label}>Name · नाम</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Customer name" placeholderTextColor="#bcc" />

        <Text style={styles.label}>Mobile · मोबाइल</Text>
        <TextInput style={styles.input} value={mobile} onChangeText={setMobile} keyboardType="phone-pad" placeholder="10-digit number" placeholderTextColor="#bcc" maxLength={10} />

        <Text style={styles.label}>Address (optional)</Text>
        <TextInput style={styles.input} value={address} onChangeText={setAddress} placeholder="House / street" placeholderTextColor="#bcc" />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Milk & rate</Text>
        <View style={styles.typeRow}>
          {MILK_TYPES.map((t) => (
            <TouchableOpacity key={t} style={[styles.typeSeg, milkType === t && styles.typeSegOn]} onPress={() => setMilkType(t)}>
              <Text style={[styles.typeText, milkType === t && styles.typeTextOn]}>
                {t === 'cow' ? '🐄 Cow' : t === 'buff' ? '🐃 Buffalo' : '🥛 Mix'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Rate ₹/L (optional)</Text>
        <TextInput style={styles.input} keyboardType="decimal-pad" value={rate} onChangeText={setRate} placeholder={defaultRate > 0 ? String(defaultRate) : '0'} placeholderTextColor="#bcc" />
        <Text style={styles.sub}>
          {rateNum > 0
            ? `This customer pays ₹${rateNum}/L.`
            : `Left blank, so the standard ${milkType} sale rate (₹${defaultRate}/L) is used and follows any change you make to it.`}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Daily delivery</Text>

        <View style={styles.sessionBlock}>
          <View style={styles.sessionHead}>
            <Text style={styles.sessionName}>🌅 Morning · सुबह</Text>
            <Switch value={amOn} onValueChange={setAmOn} trackColor={{ true: '#00897b' }} />
          </View>
          {amOn && (
            <View style={styles.qtyRow}>
              <Text style={styles.qtyLabel}>Quantity</Text>
              <TextInput style={styles.qtyInput} keyboardType="decimal-pad" value={amQty} onChangeText={setAmQty} placeholder="0" placeholderTextColor="#bcc" />
              <Text style={styles.qtyUnit}>litres</Text>
            </View>
          )}
        </View>

        <View style={styles.sessionBlock}>
          <View style={styles.sessionHead}>
            <Text style={styles.sessionName}>🌆 Evening · शाम</Text>
            <Switch value={pmOn} onValueChange={setPmOn} trackColor={{ true: '#00897b' }} />
          </View>
          {pmOn && (
            <View style={styles.qtyRow}>
              <Text style={styles.qtyLabel}>Quantity</Text>
              <TextInput style={styles.qtyInput} keyboardType="decimal-pad" value={pmQty} onChangeText={setPmQty} placeholder="0" placeholderTextColor="#bcc" />
              <Text style={styles.qtyUnit}>litres</Text>
            </View>
          )}
        </View>

        <View style={styles.summary}>
          <Text style={styles.summaryText}>
            {dailyLitres.toFixed(1)} L per day · about ₹{(dailyLitres * effectiveRate * 30).toFixed(0)} a month
          </Text>
        </View>
      </View>

      <TouchableOpacity style={styles.btn} onPress={save} disabled={saving}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>{isEdit ? 'Save changes' : 'Add customer'}</Text>}
      </TouchableOpacity>

      {isEdit && active && (
        <TouchableOpacity style={styles.stopBtn} onPress={stopDelivery}>
          <Text style={styles.stopBtnText}>Stop delivery</Text>
        </TouchableOpacity>
      )}
      {isEdit && !active && (
        <TouchableOpacity style={styles.resumeBtn} onPress={() => setActive(true)}>
          <Text style={styles.resumeBtnText}>Delivery stopped — tap to resume, then save</Text>
        </TouchableOpacity>
      )}
      <View style={{ height: 30 }} />
    </KeyboardAwareScreen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f3f5f7' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f5f7' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12 },
  cardTitle: { fontWeight: '800', fontSize: 15, color: '#0d1b2a', marginBottom: 4 },
  label: { color: '#4a5a6a', marginTop: 10, marginBottom: 6, fontWeight: '600', fontSize: 13 },
  input: { borderWidth: 1, borderColor: '#dde', borderRadius: 10, padding: 13, fontSize: 16, color: '#111' },
  sub: { color: '#8a97a6', fontSize: 12, marginTop: 8, lineHeight: 17 },
  typeRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  typeSeg: { flex: 1, borderWidth: 1, borderColor: '#dde', borderRadius: 10, padding: 10, alignItems: 'center', backgroundColor: '#fff' },
  typeSegOn: { backgroundColor: '#00897b', borderColor: '#00897b' },
  typeText: { color: '#4a5a6a', fontWeight: '700', fontSize: 13 },
  typeTextOn: { color: '#fff' },
  sessionBlock: { borderTopWidth: 1, borderTopColor: '#eef1f4', paddingTop: 12, marginTop: 12 },
  sessionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sessionName: { fontWeight: '700', color: '#0d1b2a', fontSize: 15 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  qtyLabel: { color: '#4a5a6a', fontSize: 13, fontWeight: '600', flex: 1 },
  qtyInput: { borderWidth: 1, borderColor: '#dde', borderRadius: 10, padding: 11, width: 90, textAlign: 'center', fontSize: 18, fontWeight: '700', color: '#111' },
  qtyUnit: { color: '#8a97a6', fontSize: 13, width: 42 },
  summary: { backgroundColor: '#0d1b2a', borderRadius: 10, padding: 12, marginTop: 14, alignItems: 'center' },
  summaryText: { color: '#43e08e', fontWeight: '800', fontSize: 14 },
  btn: { backgroundColor: '#00897b', padding: 16, borderRadius: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 17 },
  stopBtn: { padding: 14, alignItems: 'center', marginTop: 8 },
  stopBtnText: { color: '#d63031', fontWeight: '700', fontSize: 14 },
  resumeBtn: { padding: 14, alignItems: 'center', marginTop: 8, backgroundColor: '#fff3e0', borderRadius: 10 },
  resumeBtnText: { color: '#e0821b', fontWeight: '700', fontSize: 13, textAlign: 'center' },
});

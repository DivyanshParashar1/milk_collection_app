import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import KeyboardAwareScreen from '../components/KeyboardAwareScreen';
import { getUnionSaleRates, setUnionSaleRates, UnionRateBasis } from '../lib/db';
import { useSubscription } from '../context/SubscriptionContext';

export default function UnionSaleRateScreen({ navigation }: any) {
  const { guard } = useSubscription();
  const [basis, setBasis] = useState<UnionRateBasis>('fat');
  const [fatRate, setFatRate] = useState('');
  const [litreRate, setLitreRate] = useState('');
  const [unionName, setUnionName] = useState('');

  useEffect(() => {
    getUnionSaleRates().then((r) => {
      setBasis(r.rate_basis);
      setFatRate(r.fat_rate > 0 ? String(r.fat_rate) : '');
      setLitreRate(r.litre_rate > 0 ? String(r.litre_rate) : '');
      setUnionName(r.union_name);
    });
  }, []);

  const fr = parseFloat(fatRate) || 0;
  const lr = parseFloat(litreRate) || 0;

  // A worked example is the fastest way to show the operator whether the number
  // they typed is the one they meant — ₹7 and ₹700 are both plausible guesses.
  const exampleQty = 100;
  const exampleFat = 6.5;
  const example = basis === 'fat' ? exampleQty * exampleFat * fr : exampleQty * lr;

  const save = async () => {
    if (!guard()) return;
    if (basis === 'fat' && !(fr > 0)) return Alert.alert('Missing', 'Enter the per fat rate');
    if (basis === 'litre' && !(lr > 0)) return Alert.alert('Missing', 'Enter the per litre rate');
    await setUnionSaleRates({ fat_rate: fr, litre_rate: lr, rate_basis: basis, union_name: unionName });
    Alert.alert('Saved ✓', 'This rate is now filled in automatically on every union sale.', [
      { text: 'OK', onPress: () => navigation.goBack() },
    ]);
  };

  return (
    <KeyboardAwareScreen style={styles.wrap} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={styles.hint}>
        Set this once. It is filled in on every union sale after that — you only change it when the union changes its rate.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>How does the union pay?</Text>
        <View style={styles.segRow}>
          {([['fat', 'Per fat'], ['litre', 'Per litre']] as const).map(([b, lbl]) => (
            <TouchableOpacity key={b} style={[styles.seg, basis === b && styles.segOn]} onPress={() => setBasis(b)}>
              <Text style={[styles.segText, basis === b && styles.segTextOn]}>{lbl}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {basis === 'fat' ? (
          <>
            <Text style={styles.label}>Rate per fat, per litre · प्रति फैट दर</Text>
            <View style={styles.inputRow}>
              <Text style={styles.rs}>₹</Text>
              <TextInput
                style={styles.input}
                keyboardType="decimal-pad"
                value={fatRate}
                onChangeText={setFatRate}
                placeholder="0"
                placeholderTextColor="#bcc"
              />
              <Text style={styles.per}>per fat / L</Text>
            </View>
            <Text style={styles.sub}>Amount = litres × fat % × this rate</Text>
          </>
        ) : (
          <>
            <Text style={styles.label}>Flat rate per litre</Text>
            <View style={styles.inputRow}>
              <Text style={styles.rs}>₹</Text>
              <TextInput
                style={styles.input}
                keyboardType="decimal-pad"
                value={litreRate}
                onChangeText={setLitreRate}
                placeholder="0"
                placeholderTextColor="#bcc"
              />
              <Text style={styles.per}>per litre</Text>
            </View>
            <Text style={styles.sub}>Amount = litres × this rate. Fat is recorded but not priced.</Text>
          </>
        )}
      </View>

      <View style={styles.exampleCard}>
        <Text style={styles.exampleTitle}>Check it</Text>
        <Text style={styles.exampleLine}>
          {exampleQty} L{basis === 'fat' ? ` at ${exampleFat} fat` : ''} would be
        </Text>
        <Text style={styles.exampleAmt}>₹{example.toFixed(0)}</Text>
        <Text style={styles.exampleHint}>If that looks wrong, the rate above is wrong.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Union / Federation name</Text>
        <TextInput
          style={styles.nameInput}
          value={unionName}
          onChangeText={setUnionName}
          placeholder="Amul, Gokul…"
          placeholderTextColor="#bcc"
        />
        <Text style={styles.sub}>Remembered too, so you don't retype it every sale.</Text>
      </View>

      <TouchableOpacity style={styles.btn} onPress={save}>
        <Text style={styles.btnText}>Save rate</Text>
      </TouchableOpacity>
      <View style={{ height: 30 }} />
    </KeyboardAwareScreen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f3f5f7' },
  hint: { color: '#67788a', fontSize: 13, marginBottom: 16, lineHeight: 20 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 12 },
  cardTitle: { fontWeight: '800', fontSize: 15, color: '#0d1b2a', marginBottom: 10 },
  segRow: { flexDirection: 'row', gap: 8 },
  seg: { flex: 1, borderWidth: 1, borderColor: '#ccd', borderRadius: 10, padding: 12, alignItems: 'center', backgroundColor: '#fff' },
  segOn: { backgroundColor: '#5f27cd', borderColor: '#5f27cd' },
  segText: { color: '#4a5a6a', fontWeight: '700' },
  segTextOn: { color: '#fff' },
  label: { color: '#4a5a6a', marginTop: 14, marginBottom: 8, fontWeight: '700', fontSize: 13 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rs: { fontSize: 22, fontWeight: '800', color: '#0d1b2a' },
  input: { flex: 1, borderWidth: 1, borderColor: '#dde', borderRadius: 10, padding: 13, fontSize: 22, fontWeight: '700', color: '#111', textAlign: 'center' },
  per: { color: '#8a97a6', fontSize: 13, width: 70 },
  nameInput: { borderWidth: 1, borderColor: '#dde', borderRadius: 10, padding: 13, fontSize: 16, color: '#111' },
  sub: { color: '#8a97a6', fontSize: 12, marginTop: 8, lineHeight: 17 },
  exampleCard: { backgroundColor: '#0d1b2a', borderRadius: 14, padding: 16, marginBottom: 12 },
  exampleTitle: { color: '#8fb', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  exampleLine: { color: '#a8b6c4', fontSize: 13, marginTop: 8 },
  exampleAmt: { color: '#43e08e', fontSize: 32, fontWeight: '800', marginTop: 2 },
  exampleHint: { color: '#67788a', fontSize: 11, marginTop: 6 },
  btn: { backgroundColor: '#5f27cd', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 17 },
});

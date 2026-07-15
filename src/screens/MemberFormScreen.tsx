import React, { useEffect, useLayoutEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import KeyboardAwareScreen from "../components/KeyboardAwareScreen";
import { insertMember, updateMember, getMemberByCode } from '../lib/db';

export default function MemberFormScreen({ navigation, route }: any) {
  const editCode: number | undefined = route?.params?.editCode;
  const isEdit = editCode != null;

  const [membercode, setMembercode] = useState(isEdit ? String(editCode) : '');
  const [name, setName] = useState('');
  const [mobile1, setMobile1] = useState('');
  const [animalType, setAnimalType] = useState<'cow' | 'buff' | 'mix'>('mix');
  const [upiId, setUpiId] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [deduction, setDeduction] = useState('');

  useLayoutEffect(() => {
    navigation.setOptions({ title: isEdit ? 'Edit Farmer · किसान' : 'Add Farmer · किसान' });
  }, [isEdit, navigation]);

  // prefill when editing
  useEffect(() => {
    if (!isEdit) return;
    getMemberByCode(editCode!).then((m) => {
      if (!m) return;
      setName(m.name ?? '');
      setMobile1(m.mobile1 ?? '');
      setAnimalType((m.animal_type as any) ?? 'mix');
      setUpiId(m.upi_id ?? '');
      setBankAccount(m.bank_account ?? '');
      setIfsc(m.ifsc_code ?? '');
      setDeduction(m.fix_deduction ? String(m.fix_deduction) : '');
    });
  }, [isEdit, editCode]);

  const save = async () => {
    const code = parseInt(membercode, 10);
    if (!code || !name.trim()) return Alert.alert('Missing', 'Member code and name are required');
    const payload = {
      membercode: code,
      name: name.trim(),
      mobile1: mobile1.trim() || undefined,
      animal_type: animalType,
      upi_id: upiId.trim() || undefined,
      bank_account: bankAccount.trim() || undefined,
      ifsc_code: ifsc.trim() || undefined,
      fix_deduction: parseFloat(deduction) || 0,
    };
    try {
      if (isEdit) await updateMember(payload);
      else await insertMember(payload);
      Alert.alert('Saved', `Farmer ${code} ${isEdit ? 'updated' : 'saved'}`, [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e));
    }
  };

  return (
    <KeyboardAwareScreen style={styles.wrap} contentContainerStyle={{ padding: 16 }}>
      <Field label="Member code *"><TextInput style={[styles.input, isEdit && styles.inputDisabled]} editable={!isEdit} keyboardType="number-pad" value={membercode} onChangeText={setMembercode} placeholder="e.g. 101" placeholderTextColor="#9aa" /></Field>
      <Field label="Name *"><TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Farmer name" placeholderTextColor="#9aa" /></Field>
      <Field label="Mobile"><TextInput style={styles.input} keyboardType="phone-pad" value={mobile1} onChangeText={setMobile1} placeholder="10-digit mobile" placeholderTextColor="#9aa" /></Field>

      <Field label="Animal type">
        <View style={styles.segRow}>
          {(['cow', 'buff', 'mix'] as const).map((a) => (
            <TouchableOpacity key={a} style={[styles.seg, animalType === a && styles.segActive]} onPress={() => setAnimalType(a)}>
              <Text style={[styles.segText, animalType === a && styles.segTextActive]}>{a.toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Field>

      <Text style={styles.section}>Payout details</Text>
      <Field label="UPI id (optional — else mobile number is used)"><TextInput style={styles.input} autoCapitalize="none" value={upiId} onChangeText={setUpiId} placeholder="98765xxxxx@ybl" placeholderTextColor="#9aa" /></Field>
      <Field label="Bank account no. (optional)"><TextInput style={styles.input} keyboardType="number-pad" value={bankAccount} onChangeText={setBankAccount} placeholder="Account number" placeholderTextColor="#9aa" /></Field>
      <Field label="IFSC code (optional)"><TextInput style={styles.input} autoCapitalize="characters" value={ifsc} onChangeText={setIfsc} placeholder="e.g. SBIN0001234" placeholderTextColor="#9aa" /></Field>
      <Field label="Fixed deduction (kapat %)"><TextInput style={styles.input} keyboardType="decimal-pad" value={deduction} onChangeText={setDeduction} placeholder="0" placeholderTextColor="#9aa" /></Field>

      <TouchableOpacity style={styles.btn} onPress={save}><Text style={styles.btnText}>Save member</Text></TouchableOpacity>
    </KeyboardAwareScreen>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={{ marginBottom: 14 }}><Text style={styles.label}>{label}</Text>{children}</View>;
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f3f5f7' },
  label: { color: '#4a5a6a', marginBottom: 6, fontWeight: '600', fontSize: 13 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#dde', borderRadius: 10, padding: 13, fontSize: 16, color: '#111' },
  inputDisabled: { backgroundColor: '#eef1f4', color: '#8a97a6' },
  section: { fontWeight: '800', fontSize: 15, color: '#0d1b2a', marginTop: 8, marginBottom: 12 },
  segRow: { flexDirection: 'row', gap: 8 },
  seg: { flex: 1, borderWidth: 1, borderColor: '#ccd', borderRadius: 10, padding: 12, alignItems: 'center', backgroundColor: '#fff' },
  segActive: { backgroundColor: '#1b9c66', borderColor: '#1b9c66' },
  segText: { color: '#4a5a6a', fontWeight: '700' },
  segTextActive: { color: '#fff' },
  btn: { backgroundColor: '#1b9c66', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 10, marginBottom: 40 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});

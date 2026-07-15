import React, { useCallback, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { insertKapatItem, updateKapatItem, deleteKapatItem, listKapatItems, LocalKapatItem } from '../lib/db';

type EditState = { localId?: number; name: string; type: 'percent' | 'fixed'; value: string };
const EMPTY: EditState = { name: '', type: 'percent', value: '' };

export default function KapatScreen() {
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState<EditState>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => setItems(await listKapatItems()), []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const save = async () => {
    if (!form.name.trim()) return Alert.alert('Missing', 'Enter a deduction name');
    const val = parseFloat(form.value);
    if (!val || val <= 0) return Alert.alert('Missing', 'Enter a value > 0');

    setSaving(true);
    try {
      const item: LocalKapatItem = { name: form.name.trim(), type: form.type, value: val };
      if (form.localId) {
        await updateKapatItem(form.localId, item);
      } else {
        await insertKapatItem(item);
      }
      setForm(EMPTY);
      await load();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const del = (id: number, name: string) => {
    Alert.alert('Delete?', `Remove "${name}" deduction?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteKapatItem(id); await load(); } },
    ]);
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={styles.hint}>
        Define deduction categories (kapat) that apply to farmers. Each can be a fixed ₹ amount or a % of milk value.
      </Text>

      <View style={styles.card}>
        <Text style={styles.formTitle}>{form.localId ? 'Edit deduction' : 'Add deduction'}</Text>

        <Text style={styles.label}>Name</Text>
        <TextInput style={styles.input} value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} placeholder="Loan EMI, Feed, Insurance…" placeholderTextColor="#bcc" />

        <Text style={styles.label}>Type</Text>
        <View style={styles.typeRow}>
          <TouchableOpacity style={[styles.typeSeg, form.type === 'percent' && styles.typeOn]} onPress={() => setForm({ ...form, type: 'percent' })}>
            <Text style={[styles.typeText, form.type === 'percent' && styles.typeTextOn]}>% Percent</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.typeSeg, form.type === 'fixed' && styles.typeOn]} onPress={() => setForm({ ...form, type: 'fixed' })}>
            <Text style={[styles.typeText, form.type === 'fixed' && styles.typeTextOn]}>₹ Fixed</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>Value</Text>
        <TextInput style={styles.input} keyboardType="decimal-pad" value={form.value} onChangeText={(v) => setForm({ ...form, value: v })}
          placeholder={form.type === 'percent' ? '2.5 (%)' : '50 (₹)'} placeholderTextColor="#bcc" />

        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>{form.localId ? 'Update' : 'Add'}</Text>}
          </TouchableOpacity>
          {form.localId && (
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setForm(EMPTY)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {items.length > 0 && (
        <>
          <Text style={styles.section}>Active deductions ({items.length})</Text>
          {items.map((k) => (
            <View key={k.local_id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{k.name}</Text>
                <Text style={styles.rowDetail}>
                  {k.type === 'percent' ? `${k.value}%` : `₹${k.value}`} · {k.type === 'percent' ? 'of milk value' : 'fixed per entry'}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setForm({ localId: k.local_id, name: k.name, type: k.type, value: String(k.value) })} hitSlop={10}>
                <Text style={styles.editBtn}>✏️</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => del(k.local_id, k.name)} hitSlop={10}>
                <Text style={styles.delBtn}>🗑️</Text>
              </TouchableOpacity>
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
  hint: { color: '#67788a', fontSize: 13, marginBottom: 14, lineHeight: 20 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16 },
  formTitle: { fontWeight: '800', color: '#0d1b2a', fontSize: 16, marginBottom: 4 },
  label: { color: '#4a5a6a', marginTop: 12, marginBottom: 6, fontWeight: '600', fontSize: 13 },
  input: { borderWidth: 1, borderColor: '#dde', borderRadius: 10, padding: 13, fontSize: 16, color: '#111' },
  typeRow: { flexDirection: 'row', gap: 10 },
  typeSeg: { flex: 1, borderWidth: 1.5, borderColor: '#dde', borderRadius: 10, padding: 12, alignItems: 'center', backgroundColor: '#fff' },
  typeOn: { backgroundColor: '#8a3ffc', borderColor: '#8a3ffc' },
  typeText: { fontWeight: '700', color: '#4a5a6a' },
  typeTextOn: { color: '#fff' },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  saveBtn: { flex: 1, backgroundColor: '#8a3ffc', padding: 15, borderRadius: 12, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  cancelBtn: { padding: 15, borderRadius: 12, borderWidth: 1, borderColor: '#ccd' },
  cancelText: { color: '#4a5a6a', fontWeight: '700' },
  section: { fontWeight: '800', color: '#0d1b2a', marginTop: 24, marginBottom: 8, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 6, gap: 12 },
  rowName: { fontWeight: '700', color: '#0d1b2a', fontSize: 15 },
  rowDetail: { color: '#67788a', fontSize: 12, marginTop: 2 },
  editBtn: { fontSize: 18 },
  delBtn: { fontSize: 18 },
});

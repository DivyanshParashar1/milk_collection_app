import React, { useCallback, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Linking } from 'react-native';
import KeyboardAwareScreen from '../components/KeyboardAwareScreen';
import DatePickerInput from '../components/DatePickerInput';
import { useFocusEffect } from '@react-navigation/native';
import { routineChecklist, saveRoutineChecklist, getLocalSaleRates, todayIST } from '../lib/db';
import { useSubscription } from '../context/SubscriptionContext';

/** A checklist row: the customer plus whatever the operator has done to it. */
type Row = {
  local_id: number;
  name: string;
  mobile: string | null;
  address: string | null;
  milk_type: string;
  rate: number;
  standing_qty: number;
  delivery_id: number | null;
  delivered_qty: number | null;
  delivered_rate: number | null;
  /** Ticked = milk went out today. */
  checked: boolean;
  /** Editable, because 2 L customers take 1 L some days. */
  qty: string;
  effectiveRate: number;
};

export default function RoutineSaleScreen({ navigation }: any) {
  const { guard } = useSubscription();
  const [date, setDate] = useState(todayIST());
  const [session, setSession] = useState<0 | 1>(new Date().getHours() < 14 ? 0 : 1);
  const [rows, setRows] = useState<Row[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, rates] = await Promise.all([routineChecklist(date, session), getLocalSaleRates()]);
      const rateByType = new Map(rates.map((r) => [r.milk_type, r.rate_per_litre]));
      setRows(list.map((c: any): Row => {
        // A customer's own rate wins; otherwise fall back to the shared local
        // sale rate for their milk type, same as the walk-in screen uses.
        const effectiveRate = c.rate > 0 ? c.rate : (rateByType.get(c.milk_type) ?? 0);
        // A saved delivery means this day was already done — show it ticked
        // with what was actually saved, not the standing quantity.
        const already = c.delivery_id != null;
        return {
          local_id: c.local_id,
          name: c.name,
          mobile: c.mobile,
          address: c.address,
          milk_type: c.milk_type,
          rate: c.rate,
          standing_qty: c.standing_qty ?? 0,
          delivery_id: c.delivery_id,
          delivered_qty: c.delivered_qty,
          delivered_rate: c.delivered_rate,
          checked: already,
          qty: String(already ? c.delivered_qty : (c.standing_qty ?? 0)),
          effectiveRate: already && c.delivered_rate > 0 ? c.delivered_rate : effectiveRate,
        };
      }));
    } finally {
      setLoading(false);
    }
  }, [date, session]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const setRow = (id: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.local_id === id ? { ...r, ...patch } : r)));

  const toggle = (r: Row) => setRow(r.local_id, { checked: !r.checked });

  const checkedRows = rows.filter((r) => r.checked && (parseFloat(r.qty) || 0) > 0);
  const totalLitres = checkedRows.reduce((s, r) => s + (parseFloat(r.qty) || 0), 0);
  const totalAmount = checkedRows.reduce((s, r) => s + (parseFloat(r.qty) || 0) * r.effectiveRate, 0);

  const markAll = () => {
    const allOn = rows.every((r) => r.checked);
    setRows((rs) => rs.map((r) => ({ ...r, checked: !allOn, qty: r.checked && allOn ? r.qty : String(r.standing_qty) })));
  };

  const save = async () => {
    if (!guard()) return;
    setSaving(true);
    try {
      await saveRoutineChecklist(
        date,
        session,
        checkedRows.map((r) => ({
          customer_id: r.local_id,
          quantity: parseFloat(r.qty) || 0,
          rate: r.effectiveRate,
        }))
      );
      Alert.alert('Saved ✓', `${checkedRows.length} deliveries · ${totalLitres.toFixed(1)} L · ₹${totalAmount.toFixed(0)}`);
      await load();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAwareScreen style={styles.wrap} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <View style={styles.topRow}>
        <DatePickerInput value={date} onChange={setDate} label="Delivery date" />
      </View>

      <View style={styles.sessionRow}>
        {([[0, '🌅 Morning'], [1, '🌆 Evening']] as const).map(([s, lbl]) => (
          <TouchableOpacity key={s} style={[styles.seg, session === s && styles.segOn]} onPress={() => setSession(s as 0 | 1)}>
            <Text style={[styles.segText, session === s && styles.segTextOn]}>{lbl}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color="#00897b" style={{ marginTop: 40 }} />
      ) : rows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>👥</Text>
          <Text style={styles.emptyText}>
            No customers set for {session === 0 ? 'morning' : 'evening'} delivery.
          </Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => navigation.navigate('RoutineCustomerForm', {})}>
            <Text style={styles.emptyBtnText}>+ Add a customer</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={styles.listHead}>
            <Text style={styles.listHeadText}>{rows.length} customers</Text>
            <TouchableOpacity onPress={markAll}>
              <Text style={styles.markAll}>{rows.every((r) => r.checked) ? 'Untick all' : 'Tick all'}</Text>
            </TouchableOpacity>
          </View>

          {rows.map((r) => {
            const open = expanded === r.local_id;
            const qtyNum = parseFloat(r.qty) || 0;
            return (
              <View key={r.local_id} style={[styles.row, r.checked && styles.rowOn]}>
                {/* Tapping the row reveals the mobile number; the tick box is
                    its own target so opening details never marks a delivery. */}
                <TouchableOpacity
                  style={styles.rowMain}
                  onPress={() => setExpanded(open ? null : r.local_id)}
                  activeOpacity={0.7}
                >
                  <TouchableOpacity style={[styles.check, r.checked && styles.checkOn]} onPress={() => toggle(r)} hitSlop={10}>
                    <Text style={styles.checkMark}>{r.checked ? '✓' : ''}</Text>
                  </TouchableOpacity>

                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{r.name}</Text>
                    <Text style={styles.sub}>
                      {r.milk_type === 'cow' ? '🐄 Cow' : r.milk_type === 'buff' ? '🐃 Buffalo' : '🥛 Mix'} · ₹{r.effectiveRate}/L
                      {r.delivery_id != null ? ' · saved' : ''}
                    </Text>
                  </View>

                  <TextInput
                    style={[styles.qtyInput, r.checked && styles.qtyInputOn]}
                    keyboardType="decimal-pad"
                    value={r.qty}
                    onChangeText={(v) => setRow(r.local_id, { qty: v, checked: true })}
                    placeholder="0"
                    placeholderTextColor="#bcc"
                  />
                  <Text style={styles.litre}>L</Text>
                  <Text style={styles.chev}>{open ? '▴' : '▾'}</Text>
                </TouchableOpacity>

                {open && (
                  <View style={styles.details}>
                    <View style={styles.detailLine}>
                      <Text style={styles.detailLabel}>Mobile</Text>
                      <Text style={styles.detailVal}>{r.mobile || '—'}</Text>
                    </View>
                    {!!r.address && (
                      <View style={styles.detailLine}>
                        <Text style={styles.detailLabel}>Address</Text>
                        <Text style={styles.detailVal}>{r.address}</Text>
                      </View>
                    )}
                    <View style={styles.detailLine}>
                      <Text style={styles.detailLabel}>Usual</Text>
                      <Text style={styles.detailVal}>{r.standing_qty} L</Text>
                    </View>
                    <View style={styles.detailLine}>
                      <Text style={styles.detailLabel}>Today</Text>
                      <Text style={styles.detailVal}>{qtyNum} L × ₹{r.effectiveRate} = ₹{(qtyNum * r.effectiveRate).toFixed(2)}</Text>
                    </View>
                    <View style={styles.detailBtns}>
                      {!!r.mobile && (
                        <TouchableOpacity style={styles.callBtn} onPress={() => Linking.openURL(`tel:${r.mobile}`)}>
                          <Text style={styles.callBtnText}>📞 Call</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={styles.acctBtn}
                        onPress={() => navigation.navigate('RoutineStatement', { customerId: r.local_id, name: r.name })}
                      >
                        <Text style={styles.acctBtnText}>📄 Account</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.editBtn}
                        onPress={() => navigation.navigate('RoutineCustomerForm', { customerId: r.local_id })}
                      >
                        <Text style={styles.editBtnText}>✏️ Edit</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            );
          })}

          <View style={styles.totalBar}>
            <View style={styles.totalItem}><Text style={styles.totalVal}>{checkedRows.length}</Text><Text style={styles.totalLbl}>delivered</Text></View>
            <View style={styles.totalItem}><Text style={styles.totalVal}>{totalLitres.toFixed(1)}</Text><Text style={styles.totalLbl}>litres</Text></View>
            <View style={styles.totalItem}><Text style={[styles.totalVal, { color: '#43e08e' }]}>₹{totalAmount.toFixed(0)}</Text><Text style={styles.totalLbl}>amount</Text></View>
          </View>

          <TouchableOpacity style={styles.btn} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Save delivery list</Text>}
          </TouchableOpacity>
        </>
      )}

      <TouchableOpacity style={styles.link} onPress={() => navigation.navigate('RoutineCustomers')}>
        <Text style={styles.linkText}>👥 Customers & accounts</Text>
      </TouchableOpacity>
      <View style={{ height: 30 }} />
    </KeyboardAwareScreen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f3f5f7' },
  topRow: { flexDirection: 'row', marginBottom: 12 },
  sessionRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  seg: { flex: 1, borderWidth: 1, borderColor: '#ccd', borderRadius: 10, padding: 12, alignItems: 'center', backgroundColor: '#fff' },
  segOn: { backgroundColor: '#00897b', borderColor: '#00897b' },
  segText: { color: '#4a5a6a', fontWeight: '700' },
  segTextOn: { color: '#fff' },
  listHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  listHeadText: { color: '#67788a', fontSize: 12, fontWeight: '700' },
  markAll: { color: '#00897b', fontWeight: '800', fontSize: 13 },
  row: { backgroundColor: '#fff', borderRadius: 12, marginBottom: 8, borderWidth: 2, borderColor: 'transparent', overflow: 'hidden' },
  rowOn: { borderColor: '#00897b' },
  rowMain: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  check: { width: 30, height: 30, borderRadius: 8, borderWidth: 2, borderColor: '#ccd', alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: '#00897b', borderColor: '#00897b' },
  checkMark: { color: '#fff', fontWeight: '900', fontSize: 17 },
  name: { fontWeight: '700', color: '#0d1b2a', fontSize: 15 },
  sub: { color: '#67788a', fontSize: 11, marginTop: 2 },
  qtyInput: { borderWidth: 1, borderColor: '#dde', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 6, width: 58, textAlign: 'center', fontSize: 16, fontWeight: '700', color: '#111' },
  qtyInputOn: { borderColor: '#00897b' },
  litre: { color: '#8a97a6', fontSize: 12, marginLeft: -4 },
  chev: { color: '#b0bcc8', fontSize: 14 },
  details: { borderTopWidth: 1, borderTopColor: '#eef1f4', backgroundColor: '#fafbfc', padding: 12 },
  detailLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  detailLabel: { color: '#8a97a6', fontSize: 13 },
  detailVal: { color: '#0d1b2a', fontSize: 14, fontWeight: '700' },
  detailBtns: { flexDirection: 'row', gap: 8, marginTop: 10 },
  callBtn: { flex: 1, backgroundColor: '#1b9c66', borderRadius: 8, padding: 10, alignItems: 'center' },
  callBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  acctBtn: { flex: 1, backgroundColor: '#2a6fdb', borderRadius: 8, padding: 10, alignItems: 'center' },
  acctBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  editBtn: { flex: 1, backgroundColor: '#eef1f4', borderRadius: 8, padding: 10, alignItems: 'center' },
  editBtnText: { color: '#4a5a6a', fontWeight: '800', fontSize: 13 },
  totalBar: { flexDirection: 'row', backgroundColor: '#0d1b2a', borderRadius: 12, padding: 14, marginTop: 8 },
  totalItem: { flex: 1, alignItems: 'center' },
  totalVal: { color: '#fff', fontWeight: '800', fontSize: 20 },
  totalLbl: { color: '#67788a', fontSize: 10, marginTop: 2 },
  btn: { backgroundColor: '#00897b', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 14 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 17 },
  empty: { alignItems: 'center', padding: 30 },
  emptyIcon: { fontSize: 44 },
  emptyText: { color: '#67788a', textAlign: 'center', marginTop: 12, fontSize: 14, lineHeight: 20 },
  emptyBtn: { backgroundColor: '#00897b', paddingHorizontal: 22, paddingVertical: 13, borderRadius: 10, marginTop: 16 },
  emptyBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  link: { alignItems: 'center', marginTop: 16 },
  linkText: { color: '#2a6fdb', fontWeight: '700', fontSize: 14 },
});

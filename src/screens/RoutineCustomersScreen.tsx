import React, { useCallback, useLayoutEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { listRoutineCustomers, routineOutstandingByCustomer } from '../lib/db';

export default function RoutineCustomersScreen({ navigation }: any) {
  const [customers, setCustomers] = useState<any[]>([]);
  const [outstanding, setOutstanding] = useState<Map<number, number>>(new Map());
  const [query, setQuery] = useState('');
  const [showStopped, setShowStopped] = useState(false);
  const [loading, setLoading] = useState(true);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={() => navigation.navigate('RoutineCustomerForm', {})} hitSlop={12}>
          <Text style={{ color: '#fff', fontSize: 26, fontWeight: '900' }}>＋</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  useFocusEffect(useCallback(() => {
    let alive = true;
    Promise.all([listRoutineCustomers(true), routineOutstandingByCustomer()]).then(([list, out]) => {
      if (!alive) return;
      setCustomers(list);
      setOutstanding(out);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []));

  const q = query.trim().toLowerCase();
  const visible = customers
    .filter((c) => (showStopped ? true : c.active === 1))
    .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.mobile ?? '').includes(q));

  const totalDue = visible.reduce((s, c) => s + Math.max(0, outstanding.get(c.local_id) ?? 0), 0);
  const stoppedCount = customers.filter((c) => c.active !== 1).length;

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color="#00897b" size="large" /></View>;
  }

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <View style={styles.statsRow}>
        <View style={styles.stat}><Text style={styles.statVal}>{visible.length}</Text><Text style={styles.statLbl}>Customers</Text></View>
        <View style={styles.stat}><Text style={[styles.statVal, { color: '#d63031' }]}>₹{totalDue.toFixed(0)}</Text><Text style={styles.statLbl}>Total due</Text></View>
      </View>

      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        placeholder="Search name or mobile"
        placeholderTextColor="#bcc"
      />

      {customers.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>👥</Text>
          <Text style={styles.emptyText}>No routine customers yet.{'\n'}Add the people you deliver milk to every day.</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => navigation.navigate('RoutineCustomerForm', {})}>
            <Text style={styles.emptyBtnText}>+ Add first customer</Text>
          </TouchableOpacity>
        </View>
      ) : (
        visible.map((c) => {
          const due = outstanding.get(c.local_id) ?? 0;
          const daily = (c.am_active ? c.am_qty : 0) + (c.pm_active ? c.pm_qty : 0);
          return (
            <TouchableOpacity
              key={c.local_id}
              style={[styles.row, c.active !== 1 && styles.rowStopped]}
              onPress={() => navigation.navigate('RoutineStatement', { customerId: c.local_id, name: c.name })}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>
                  {c.name}{c.active !== 1 ? '  (stopped)' : ''}
                </Text>
                <Text style={styles.sub}>
                  {c.mobile || 'no mobile'} · {daily} L/day
                  {c.am_active ? ' · AM' : ''}{c.pm_active ? ' · PM' : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.due, due > 0 ? styles.dueOwed : styles.dueClear]}>
                  {due > 0 ? `₹${due.toFixed(0)}` : due < 0 ? `₹${Math.abs(due).toFixed(0)} adv` : '✓'}
                </Text>
                <Text style={styles.dueLbl}>{due > 0 ? 'due' : due < 0 ? 'advance' : 'settled'}</Text>
              </View>
            </TouchableOpacity>
          );
        })
      )}

      {stoppedCount > 0 && (
        <TouchableOpacity style={styles.link} onPress={() => setShowStopped((s) => !s)}>
          <Text style={styles.linkText}>
            {showStopped ? 'Hide' : 'Show'} {stoppedCount} stopped customer{stoppedCount > 1 ? 's' : ''}
          </Text>
        </TouchableOpacity>
      )}
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f3f5f7' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f5f7' },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  stat: { flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 14, alignItems: 'center' },
  statVal: { fontSize: 22, fontWeight: '800', color: '#00897b' },
  statLbl: { color: '#67788a', marginTop: 4, fontSize: 11 },
  search: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#dde', borderRadius: 10, padding: 12, fontSize: 15, color: '#111', marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, gap: 10 },
  rowStopped: { opacity: 0.55 },
  name: { fontWeight: '700', color: '#0d1b2a', fontSize: 15 },
  sub: { color: '#67788a', fontSize: 12, marginTop: 3 },
  due: { fontWeight: '800', fontSize: 16 },
  dueOwed: { color: '#d63031' },
  dueClear: { color: '#1b9c66' },
  dueLbl: { color: '#8a97a6', fontSize: 10, marginTop: 1 },
  empty: { alignItems: 'center', padding: 30 },
  emptyIcon: { fontSize: 44 },
  emptyText: { color: '#67788a', textAlign: 'center', marginTop: 12, fontSize: 14, lineHeight: 20 },
  emptyBtn: { backgroundColor: '#00897b', paddingHorizontal: 22, paddingVertical: 13, borderRadius: 10, marginTop: 16 },
  emptyBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  link: { alignItems: 'center', marginTop: 12 },
  linkText: { color: '#2a6fdb', fontWeight: '700', fontSize: 13 },
});

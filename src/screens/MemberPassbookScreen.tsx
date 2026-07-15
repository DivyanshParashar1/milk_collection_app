import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { memberPassbook, PassbookEntry, getMemberByCode } from '../lib/db';

export default function MemberPassbookScreen({ route }: any) {
  const membercode: number = route.params?.membercode;
  const [entries, setEntries] = useState<PassbookEntry[]>([]);
  const [memberName, setMemberName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const m = await getMemberByCode(membercode);
      setMemberName(m?.name ?? `#${membercode}`);
      setEntries(await memberPassbook(membercode));
      setLoading(false);
    })();
  }, [membercode]);

  // running balance
  let runningBal = 0;
  const withBalance = entries.slice().reverse().map((e) => {
    runningBal += e.credit - e.debit;
    return { ...e, balance: runningBal };
  }).reverse();

  const totalCredit = entries.reduce((s, e) => s + e.credit, 0);
  const totalDebit = entries.reduce((s, e) => s + e.debit, 0);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#1b9c66" /></View>;

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.title}>{memberName}</Text>
      <Text style={styles.sub}>Member #{membercode}</Text>

      <View style={styles.summaryRow}>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryVal, { color: '#1b9c66' }]}>₹{totalCredit.toFixed(0)}</Text>
          <Text style={styles.summaryLbl}>Total credit</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryVal, { color: '#c0392b' }]}>₹{totalDebit.toFixed(0)}</Text>
          <Text style={styles.summaryLbl}>Total debit</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryVal, { color: runningBal >= 0 ? '#1b9c66' : '#c0392b' }]}>₹{runningBal.toFixed(0)}</Text>
          <Text style={styles.summaryLbl}>Balance</Text>
        </View>
      </View>

      {/* header */}
      <View style={styles.headerRow}>
        <Text style={[styles.hCell, { flex: 1.2 }]}>Date</Text>
        <Text style={[styles.hCell, { flex: 1.8 }]}>Description</Text>
        <Text style={[styles.hCell, styles.right]}>Cr</Text>
        <Text style={[styles.hCell, styles.right]}>Dr</Text>
        <Text style={[styles.hCell, styles.right]}>Bal</Text>
      </View>

      {withBalance.length === 0 ? (
        <Text style={styles.empty}>No transactions yet</Text>
      ) : (
        withBalance.map((e, i) => (
          <View key={i} style={[styles.row, i % 2 === 0 && styles.rowAlt]}>
            <Text style={[styles.cell, { flex: 1.2 }]}>{e.date}</Text>
            <View style={{ flex: 1.8 }}>
              <Text style={styles.cell} numberOfLines={1}>{e.description}</Text>
              <Text style={styles.typeTag}>{e.type}</Text>
            </View>
            <Text style={[styles.cell, styles.right, e.credit > 0 && { color: '#1b9c66', fontWeight: '700' }]}>{e.credit > 0 ? e.credit.toFixed(0) : ''}</Text>
            <Text style={[styles.cell, styles.right, e.debit > 0 && { color: '#c0392b', fontWeight: '700' }]}>{e.debit > 0 ? e.debit.toFixed(0) : ''}</Text>
            <Text style={[styles.cell, styles.right, { fontWeight: '700' }]}>{e.balance.toFixed(0)}</Text>
          </View>
        ))
      )}
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f3f5f7' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f3f5f7' },
  title: { fontSize: 22, fontWeight: '800', color: '#0d1b2a' },
  sub: { color: '#67788a', fontSize: 14, marginBottom: 12 },
  summaryRow: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 16, alignItems: 'center' },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryDivider: { width: 1, height: 34, backgroundColor: '#e5e9ee' },
  summaryVal: { fontSize: 20, fontWeight: '800' },
  summaryLbl: { color: '#67788a', fontSize: 11, marginTop: 2 },
  headerRow: { flexDirection: 'row', paddingHorizontal: 10, paddingBottom: 6 },
  hCell: { flex: 1, color: '#8a97a6', fontSize: 11, fontWeight: '700' },
  right: { textAlign: 'right' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 8, padding: 10, marginBottom: 4 },
  rowAlt: { backgroundColor: '#f8f9fa' },
  cell: { flex: 1, color: '#0d1b2a', fontSize: 13 },
  typeTag: { fontSize: 10, color: '#8a97a6', marginTop: 1 },
  empty: { color: '#8a97a6', fontStyle: 'italic', textAlign: 'center', marginTop: 20 },
});

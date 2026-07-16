import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getMemberByCode, farmerBalance, memberCollections, memberPayouts, deleteMember } from '../lib/db';
import { useSubscription } from '../context/SubscriptionContext';

export default function MemberDetailScreen({ route, navigation }: any) {
  const { guard } = useSubscription();
  const membercode: number = route.params.membercode;
  const [member, setMember] = useState<any | null>(null);
  const [balance, setBalance] = useState(0);
  const [collections, setCollections] = useState<any[]>([]);
  const [payouts, setPayouts] = useState<any[]>([]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        setMember(await getMemberByCode(membercode));
        setBalance(await farmerBalance(membercode));
        setCollections(await memberCollections(membercode, 15));
        setPayouts(await memberPayouts(membercode, 15));
      })();
    }, [membercode])
  );

  if (!member) return (
    <View style={[styles.wrap, { justifyContent: 'center', alignItems: 'center' }]}>
      <ActivityIndicator size="large" color="#1b9c66" />
    </View>
  );

  const onDelete = () => {
    if (!guard()) return;
    Alert.alert(
      'Delete farmer? / किसान हटाएं?',
      `"${member.name}" और उनका सारा डेटा हट जाएगा।\n"${member.name}" and all their data will be deleted.`,
      [
        { text: 'Cancel / रद्द', style: 'cancel' },
        {
          text: 'Delete / हटाएं',
          style: 'destructive',
          onPress: () =>
            Alert.alert(
              'Are you sure? / पक्का?',
              'This cannot be undone. / यह वापस नहीं होगा।',
              [
                { text: 'No / नहीं', style: 'cancel' },
                {
                  text: 'Yes, delete / हाँ, हटाएं',
                  style: 'destructive',
                  onPress: async () => {
                    await deleteMember(membercode);
                    navigation.goBack();
                  },
                },
              ]
            ),
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.card}>
        <Text style={styles.name}>{member.name}</Text>
        <Text style={styles.sub}>Code {member.membercode}{member.mobile1 ? ` · ${member.mobile1}` : ''}</Text>
        {!!member.upi_id && <Text style={styles.sub}>UPI: {member.upi_id}</Text>}
        <Text style={styles.balanceLbl}>{balance >= 0 ? 'To pay farmer / बकाया' : 'Farmer owes / वसूली'}</Text>
        <Text style={[styles.balance, { color: balance >= 0 ? '#43e08e' : '#ff6b6b' }]}>{balance >= 0 ? '' : '−'}₹{Math.abs(balance).toFixed(0)}</Text>
      </View>

      <View style={styles.actionRow}>
        {membercode !== 0 && (
          <TouchableOpacity style={[styles.action, styles.payAction]} onPress={() => navigation.navigate('Payout', { membercode })}>
            <Text style={styles.actionIcon}>💰</Text><Text style={styles.actionText}>Pay</Text>
          </TouchableOpacity>
        )}
        {membercode !== 0 && (
          <TouchableOpacity style={[styles.action, { backgroundColor: '#6c5ce7' }]} onPress={() => navigation.navigate('MemberPassbook', { membercode })}>
            <Text style={styles.actionIcon}>📒</Text><Text style={styles.actionText}>Passbook</Text>
          </TouchableOpacity>
        )}
        {membercode !== 0 && (
          <TouchableOpacity style={[styles.action, styles.editAction]} onPress={() => navigation.navigate('MemberForm', { editCode: membercode })}>
            <Text style={styles.actionIcon}>✏️</Text><Text style={styles.actionText}>Edit</Text>
          </TouchableOpacity>
        )}
        {membercode !== 0 && (
          <TouchableOpacity style={[styles.action, styles.deleteAction]} onPress={onDelete}>
            <Text style={styles.actionIcon}>🗑️</Text><Text style={styles.actionText}>Delete</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.section}>Recent milk</Text>
      {collections.length === 0 ? <Text style={styles.none}>No collections yet</Text> :
        collections.map((c) => (
          <View key={c.local_id} style={styles.histRow}>
            <Text style={styles.histDate}>{c.collect_date} · {c.session === 0 ? 'AM' : 'PM'}</Text>
            <Text style={styles.histMid}>{c.weight}L · {c.fat}%</Text>
            <Text style={styles.histAmt}>₹{Number(c.price).toFixed(0)}</Text>
          </View>
        ))}

      <Text style={styles.section}>Recent payments</Text>
      {payouts.length === 0 ? <Text style={styles.none}>No payments yet</Text> :
        payouts.map((p) => (
          <View key={p.local_id} style={styles.histRow}>
            <Text style={styles.histDate}>{(p.paid_at ?? '').slice(0, 10)}</Text>
            <Text style={styles.histMid}>{p.method === 'cash' ? '💵 Cash' : '📱 UPI'}</Text>
            <Text style={[styles.histAmt, { color: '#c0392b' }]}>-₹{Number(p.amount).toFixed(0)}</Text>
          </View>
        ))}
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f3f5f7' },
  card: { backgroundColor: '#0d1b2a', borderRadius: 16, padding: 20, alignItems: 'center' },
  name: { color: '#fff', fontSize: 24, fontWeight: '800' },
  sub: { color: '#9fb3c8', marginTop: 4 },
  balanceLbl: { color: '#8fb', marginTop: 14, fontSize: 13 },
  balance: { color: '#43e08e', fontSize: 40, fontWeight: '900' },
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  action: { flex: 1, borderRadius: 14, paddingVertical: 18, alignItems: 'center' },
  payAction: { backgroundColor: '#2a6fdb' },
  editAction: { backgroundColor: '#e0821b' },
  deleteAction: { backgroundColor: '#c0392b' },
  actionIcon: { fontSize: 26 },
  actionText: { color: '#fff', fontWeight: '800', fontSize: 14, marginTop: 4, textAlign: 'center' },
  section: { fontWeight: '800', color: '#0d1b2a', marginTop: 24, marginBottom: 8, fontSize: 15 },
  none: { color: '#8a97a6', fontStyle: 'italic' },
  histRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 6 },
  histDate: { flex: 1.4, color: '#4a5a6a', fontSize: 13 },
  histMid: { flex: 1, color: '#4a5a6a' },
  histAmt: { fontWeight: '800', color: '#1b9c66' },
});

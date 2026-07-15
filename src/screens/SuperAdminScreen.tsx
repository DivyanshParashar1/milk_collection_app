import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator, Alert, TextInput } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

export default function SuperAdminScreen() {
  const { signOut } = useAuth();
  const [societies, setSocieties] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSocieties = async () => {
    setLoading(true);
    // As super admin, RLS allows reading all societies
    const { data, error } = await supabase.from('societies').select('*').order('created_at', { ascending: false });
    if (error) Alert.alert('Error fetching societies', error.message);
    else setSocieties(data || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchSocieties();
  }, []);

  const addDays = async (id: string, currentEnd: string, days: number) => {
    const newEnd = new Date(currentEnd || Date.now());
    newEnd.setDate(newEnd.getDate() + days);
    
    const { error } = await supabase.from('societies').update({ subscription_end_date: newEnd.toISOString() }).eq('id', id);
    if (error) Alert.alert('Error', error.message);
    else fetchSocieties();
  };

  const toggleActive = async (id: string, currentStatus: boolean) => {
    const { error } = await supabase.from('societies').update({ is_active: !currentStatus }).eq('id', id);
    if (error) Alert.alert('Error', error.message);
    else fetchSocieties();
  };

  const renderItem = ({ item }: { item: any }) => {
    const expiryDate = new Date(item.subscription_end_date || Date.now());
    const isExpired = expiryDate.getTime() < Date.now();

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.socName}>{item.name}</Text>
          <Text style={styles.socCode}>Code: {item.code}</Text>
        </View>
        
        <View style={styles.statusRow}>
          <Text style={[styles.statusBadge, item.is_active ? styles.statusActive : styles.statusInactive]}>
            {item.is_active ? 'ACTIVE' : 'INACTIVE'}
          </Text>
          <Text style={[styles.statusBadge, isExpired ? styles.statusExpired : styles.statusActive]}>
            {isExpired ? 'EXPIRED' : 'SUBSCRIBED'}
          </Text>
        </View>

        <Text style={styles.detail}>Expiry: {expiryDate.toLocaleDateString()}</Text>
        <Text style={styles.detail}>Created: {new Date(item.created_at).toLocaleDateString()}</Text>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => addDays(item.id, item.subscription_end_date, 30)}>
            <Text style={styles.actionText}>+30 Days</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: item.is_active ? '#e74c3c' : '#1b9c66' }]} onPress={() => toggleActive(item.id, item.is_active)}>
            <Text style={styles.actionText}>{item.is_active ? 'Disable' : 'Enable'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title}>👑 Super Admin</Text>
        <TouchableOpacity onPress={signOut} style={styles.logoutBtn}><Text style={styles.logoutText}>Logout</Text></TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#1b9c66" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={societies}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16 }}
          ListEmptyComponent={<Text style={{ textAlign: 'center', marginTop: 20 }}>No societies found</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f3f5f7' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0d1b2a', padding: 16, paddingTop: 60 },
  title: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  logoutBtn: { backgroundColor: '#c0392b', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  logoutText: { color: '#fff', fontWeight: 'bold' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  socName: { fontSize: 18, fontWeight: 'bold', color: '#0d1b2a', flex: 1 },
  socCode: { fontSize: 14, color: '#67788a', backgroundColor: '#f3f5f7', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statusBadge: { fontSize: 10, fontWeight: 'bold', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, overflow: 'hidden' },
  statusActive: { backgroundColor: '#e8f8f2', color: '#1b9c66' },
  statusInactive: { backgroundColor: '#fcebe9', color: '#c0392b' },
  statusExpired: { backgroundColor: '#fff3e0', color: '#e67e22' },
  detail: { fontSize: 13, color: '#4a5a6a', marginBottom: 4 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16, borderTopWidth: 1, borderTopColor: '#f3f5f7', paddingTop: 16 },
  actionBtn: { flex: 1, backgroundColor: '#2a6fdb', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  actionText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
});

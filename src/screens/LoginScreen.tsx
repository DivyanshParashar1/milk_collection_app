import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useAuth } from '../context/AuthContext';

export default function LoginScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!mobile || !password) return Alert.alert('Missing', 'Enter mobile number and password');
    if (mobile.length !== 10) return Alert.alert('Invalid', 'Enter a 10-digit mobile number');
    
    setBusy(true);
    const email = `${mobile}@milkapp.local`;

    try {
      if (mode === 'in') {
        await signIn(email, password);
      } else {
        if (!fullName.trim()) return Alert.alert('Missing', 'Enter your full name to register');
        await signUp(email, password, fullName.trim());
        Alert.alert('Account Created', 'You can now sign in.');
        setMode('in');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={styles.logo}>🥛 MilkApp</Text>
      <Text style={styles.subtitle}>Dairy Collection</Text>

      <View style={styles.card}>
        <Text style={styles.h}>{mode === 'in' ? 'Sign in' : 'Create account'}</Text>
        {mode === 'up' && (
          <TextInput style={styles.input} placeholder="Dairy / Full name" value={fullName} onChangeText={setFullName} placeholderTextColor="#9aa" />
        )}
        <TextInput 
          style={styles.input} 
          placeholder="Mobile Number (10 digits)" 
          keyboardType="phone-pad" 
          maxLength={10}
          value={mobile} 
          onChangeText={setMobile} 
          placeholderTextColor="#9aa" 
        />
        <TextInput style={styles.input} placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} placeholderTextColor="#9aa" />

        <TouchableOpacity style={styles.btn} onPress={submit} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>{mode === 'in' ? 'Sign in' : 'Sign up'}</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setMode(mode === 'in' ? 'up' : 'in')}>
          <Text style={styles.link}>
            {mode === 'in' ? "No account? Sign up" : 'Have an account? Sign in'}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0d1b2a', justifyContent: 'center', padding: 24 },
  logo: { fontSize: 40, textAlign: 'center', color: '#fff', fontWeight: '800' },
  subtitle: { textAlign: 'center', color: '#8fb', marginBottom: 28, letterSpacing: 2 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 22 },
  h: { fontSize: 20, fontWeight: '700', marginBottom: 16, color: '#0d1b2a' },
  input: { borderWidth: 1, borderColor: '#dde', borderRadius: 10, padding: 14, marginBottom: 12, fontSize: 16, color: '#111' },
  btn: { backgroundColor: '#1b9c66', padding: 15, borderRadius: 10, alignItems: 'center', marginTop: 4 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  link: { textAlign: 'center', color: '#1b9c66', marginTop: 16, fontWeight: '600' },
});

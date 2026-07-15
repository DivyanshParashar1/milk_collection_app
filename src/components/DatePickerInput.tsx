import React, { useState } from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

interface Props {
  value: string; // YYYY-MM-DD
  onChange: (val: string) => void;
  label?: string;
}

export default function DatePickerInput({ value, onChange, label }: Props) {
  const [show, setShow] = useState(false);

  const dateValue = new Date(value);
  const isValid = !isNaN(dateValue.getTime());
  const displayDate = isValid ? dateValue : new Date();

  const handleConfirm = (event: any, selectedDate?: Date) => {
    setShow(Platform.OS === 'ios');
    if (selectedDate) {
      // Format as YYYY-MM-DD
      const y = selectedDate.getFullYear();
      const m = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const d = String(selectedDate.getDate()).padStart(2, '0');
      onChange(`${y}-${m}-${d}`);
    }
  };

  return (
    <View style={styles.container}>
      {!!label && <Text style={styles.label}>{label}</Text>}
      <TouchableOpacity style={styles.inputBtn} onPress={() => setShow(true)}>
        <Text style={[styles.inputText, !isValid && styles.placeholderText]}>
          {isValid ? value : 'Select Date'}
        </Text>
      </TouchableOpacity>

      {show && (
        <DateTimePicker
          value={displayDate}
          mode="date"
          display="default"
          onChange={handleConfirm}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  label: {
    color: '#67788a',
    fontSize: 12,
    marginBottom: 4,
  },
  inputBtn: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dde',
    borderRadius: 10,
    padding: 14,
    justifyContent: 'center',
  },
  inputText: {
    fontSize: 16,
    color: '#111',
  },
  placeholderText: {
    color: '#bcc',
  },
});

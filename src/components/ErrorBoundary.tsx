import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.emoji}>⚠️</Text>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.titleHi}>कुछ गलत हो गया</Text>
          <Text style={styles.subtitle}>Please restart the app.</Text>
          <Text style={styles.subtitleHi}>कृपया ऐप को फिर से शुरू करें।</Text>
          <TouchableOpacity 
            style={styles.btn} 
            onPress={() => this.setState({ hasError: false, error: null })}
          >
            <Text style={styles.btnText}>Try Again / फिर कोशिश करें</Text>
          </TouchableOpacity>
          {this.state.error && (
            <Text style={styles.errorText}>{this.state.error.toString()}</Text>
          )}
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0d1b2a',
    padding: 24,
  },
  emoji: { fontSize: 60, marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '800', color: '#fff' },
  titleHi: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 12 },
  subtitle: { fontSize: 16, color: '#8fb' },
  subtitleHi: { fontSize: 14, color: '#8fb', marginBottom: 32 },
  btn: {
    backgroundColor: '#1b9c66',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  errorText: {
    color: '#ff6b6b',
    marginTop: 32,
    fontSize: 12,
    textAlign: 'center',
    fontFamily: 'monospace',
  }
});

import { useSignUp } from '@clerk/expo';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Link, useRouter } from 'expo-router';

export default function SignUpScreen() {
  const { signUp, errors, fetchStatus } = useSignUp();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');

  const needsVerify =
    signUp.status === 'missing_requirements' &&
    signUp.unverifiedFields.includes('email_address') &&
    signUp.missingFields.length === 0;

  const handleSignUp = async () => {
    const { error } = await signUp.password({ emailAddress: email, password });
    if (error) return;
    await signUp.verifications.sendEmailCode();
  };

  const handleVerify = async () => {
    await signUp.verifications.verifyEmailCode({ code });
    if (signUp.status === 'complete') {
      await signUp.finalize({
        navigate: ({ session, decorateUrl }) => {
          if (session?.currentTask) return;
          const url = decorateUrl('/');
          if (url.startsWith('http')) {
            // web navigation
          } else {
            router.replace('/(tabs)');
          }
        },
      });
    }
  };

  if (needsVerify) {
    return (
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.inner}
        >
          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.subtitle}>We sent a code to {email}</Text>
          <TextInput
            style={styles.input}
            placeholder="Verification code"
            placeholderTextColor="#64748B"
            value={code}
            onChangeText={setCode}
            keyboardType="numeric"
          />
          {errors.fields.code && (
            <Text style={styles.error}>{errors.fields.code.message}</Text>
          )}
          <Pressable
            style={[styles.btn, fetchStatus === 'fetching' && styles.btnDisabled]}
            onPress={handleVerify}
            disabled={fetchStatus === 'fetching'}
          >
            <Text style={styles.btnText}>
              {fetchStatus === 'fetching' ? 'Verifying...' : 'Verify'}
            </Text>
          </Pressable>
          <Pressable
            style={styles.secondaryBtn}
            onPress={() => signUp.verifications.sendEmailCode()}
          >
            <Text style={styles.secondaryBtnText}>Resend code</Text>
          </Pressable>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.inner}
      >
        <View style={styles.logoBox}>
          <Text style={styles.logoText}>NO</Text>
        </View>
        <Text style={styles.title}>Get started</Text>
        <Text style={styles.subtitle}>Create your NeedsOps AI+ account</Text>

        <TextInput
          style={styles.input}
          placeholder="Email address"
          placeholderTextColor="#64748B"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        {errors.fields.emailAddress && (
          <Text style={styles.error}>{errors.fields.emailAddress.message}</Text>
        )}

        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#64748B"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        {errors.fields.password && (
          <Text style={styles.error}>{errors.fields.password.message}</Text>
        )}

        <Pressable
          style={[
            styles.btn,
            (!email || !password || fetchStatus === 'fetching') && styles.btnDisabled,
          ]}
          onPress={handleSignUp}
          disabled={!email || !password || fetchStatus === 'fetching'}
        >
          <Text style={styles.btnText}>
            {fetchStatus === 'fetching' ? 'Creating account...' : 'Create account'}
          </Text>
        </Pressable>

        <View style={styles.linkRow}>
          <Text style={styles.linkText}>Already have an account? </Text>
          <Link href="/(auth)/sign-in">
            <Text style={styles.link}>Sign in</Text>
          </Link>
        </View>

        <View nativeID="clerk-captcha" />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B1829' },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 12 },
  logoBox: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#112033',
    borderWidth: 1,
    borderColor: '#1E3A5F',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 4,
  },
  logoText: { color: '#00D4FF', fontWeight: '700', fontSize: 18 },
  title: { color: '#E2E8F0', fontSize: 24, fontWeight: '700', textAlign: 'center' },
  subtitle: { color: '#64748B', fontSize: 14, textAlign: 'center', marginBottom: 8 },
  input: {
    backgroundColor: '#112033',
    borderWidth: 1,
    borderColor: '#1E3A5F',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#E2E8F0',
    fontSize: 15,
  },
  error: { color: '#F87171', fontSize: 12, marginTop: -4 },
  btn: {
    backgroundColor: '#00D4FF',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#0B1829', fontWeight: '700', fontSize: 15 },
  secondaryBtn: { alignItems: 'center', paddingVertical: 10 },
  secondaryBtnText: { color: '#00D4FF', fontSize: 14 },
  linkRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 8 },
  linkText: { color: '#64748B', fontSize: 14 },
  link: { color: '#00D4FF', fontSize: 14 },
});

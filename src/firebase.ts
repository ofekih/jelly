import { initializeApp } from 'firebase/app';
import {
  Analytics,
  getAnalytics,
  isSupported,
  logEvent,
  setUserId,
} from 'firebase/analytics';
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

const firebaseConfig = {
  projectId: 'ofek-beli-ranker',
  appId: '1:628127085340:web:7e56cafaa22699796b80d9',
  storageBucket: 'ofek-beli-ranker.firebasestorage.app',
  apiKey: 'AIzaSyAHvloEBjincUxAh_McuhS32oVcjuOvIsY',
  authDomain: 'eatwithjelly.com',
  messagingSenderId: '628127085340',
  measurementId: 'G-FEYZ9V0TQ5',
};

export const DEFAULT_PLACES_API_KEY = 'AIzaSyAi7dipjBO3RrtEaFc9tBHmOjG0v4RxQqY';

/**
 * `npm run dev:emu`: the app talks to local Auth + Firestore emulators (real rules) holding seeded
 * test accounts, under a `demo-` project that only exists locally. Nothing reaches production.
 */
export const IS_EMULATOR = import.meta.env.MODE === 'emulator';
export const EMULATOR_PROJECT_ID = 'demo-jelly-dev';

const app = initializeApp(IS_EMULATOR ? { ...firebaseConfig, projectId: EMULATOR_PROJECT_ID } : firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

if (IS_EMULATOR) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  void import('./dev/emulator').then((m) => m.startEmulatorSession(auth));
}

let analyticsInstance: Analytics | null = null;

if (typeof window !== 'undefined' && !IS_EMULATOR) {
  isSupported()
    .then((supported) => {
      if (supported) {
        analyticsInstance = getAnalytics(app);
      }
    })
    .catch(() => {
      // Ignore in unsupported environments
    });
}

export function trackEvent(eventName: string, params?: Record<string, any>) {
  if (!analyticsInstance) return;
  try {
    logEvent(analyticsInstance, eventName, params);
  } catch {
    // Ignore analytics errors
  }
}

export function setAnalyticsUser(uid: string | null) {
  if (!analyticsInstance) return;
  try {
    setUserId(analyticsInstance, uid);
  } catch {
    // Ignore analytics errors
  }
}


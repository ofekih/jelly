import { initializeApp } from 'firebase/app';
import {
  Analytics,
  getAnalytics,
  isSupported,
  logEvent,
  setUserId,
} from 'firebase/analytics';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

export const firebaseConfig = {
  projectId: 'ofek-beli-ranker',
  appId: '1:628127085340:web:7e56cafaa22699796b80d9',
  storageBucket: 'ofek-beli-ranker.firebasestorage.app',
  apiKey: 'AIzaSyAHvloEBjincUxAh_McuhS32oVcjuOvIsY',
  authDomain: 'ofek-beli-ranker.firebaseapp.com',
  messagingSenderId: '628127085340',
  measurementId: 'G-FEYZ9V0TQ5',
};

export const DEFAULT_PLACES_API_KEY = 'AIzaSyAi7dipjBO3RrtEaFc9tBHmOjG0v4RxQqY';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

let analyticsInstance: Analytics | null = null;

if (typeof window !== 'undefined') {
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


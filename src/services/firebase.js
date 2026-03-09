import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { disableNetwork, enableNetwork, getFirestore, initializeFirestore, setLogLevel } from 'firebase/firestore';
import { isSupported, getAnalytics } from 'firebase/analytics';

function hasPlaceholder(value = '') {
  return (
    !value ||
    value.includes('...') ||
    value.includes('your-project') ||
    value.includes('abcdef') ||
    value.includes('123456789')
  );
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

const requiredFirebaseFields = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId'
];

const invalidField = requiredFirebaseFields.find((field) => hasPlaceholder(firebaseConfig[field]));

if (invalidField) {
  throw new Error(
    `Firebase config invalida: "${invalidField}". ` +
      'Define valores reales en .env.local o en CI/CD (GitHub Secrets VITE_FIREBASE_*) y vuelve a generar el build.'
  );
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export the necessary Firebase services
export const auth = getAuth(app);
export const db = (() => {
  try {
    return initializeFirestore(app, {
      // Helps on mobile networks / webviews where streaming transports can be flaky.
      experimentalAutoDetectLongPolling: true,
      experimentalForceLongPolling: import.meta.env.VITE_FIREBASE_FORCE_LONG_POLLING === 'true',
      useFetchStreams: false
    });
  } catch {
    // HMR or multiple initializations: fall back to the already-initialized instance.
    return getFirestore(app);
  }
})();
setLogLevel('error');

if (typeof window !== 'undefined') {
  const syncFirestoreNetworkState = async () => {
    try {
      if (navigator.onLine) {
        await enableNetwork(db);
      } else {
        await disableNetwork(db);
      }
    } catch {
      // Ignore transient network toggling errors.
    }
  };

  window.addEventListener('online', syncFirestoreNetworkState);
  window.addEventListener('offline', syncFirestoreNetworkState);
  if (!navigator.onLine) {
    syncFirestoreNetworkState();
  }
}

// Analytics depends on Firebase Installations. Keep it isolated so a bad
// analytics/installations config does not break auth or Firestore sync.
const analyticsEnabled = import.meta.env.VITE_FIREBASE_ENABLE_ANALYTICS === 'true';

if (
  typeof window !== 'undefined' &&
  analyticsEnabled &&
  firebaseConfig.measurementId &&
  !hasPlaceholder(firebaseConfig.measurementId)
) {
  isSupported()
    .then((supported) => {
      if (!supported) return;
      try {
        getAnalytics(app);
      } catch (error) {
        console.warn('Firebase Analytics disabled:', error);
      }
    })
    .catch((error) => {
      console.warn('Firebase Analytics support check failed:', error);
    });
}

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getAnalytics } from 'firebase/analytics';

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
export const db = getFirestore(app);

// Initialize Analytics. For GDPR/privacy, this could be made conditional.
if (typeof window !== 'undefined' && firebaseConfig.measurementId && !hasPlaceholder(firebaseConfig.measurementId)) {
  getAnalytics(app);
}

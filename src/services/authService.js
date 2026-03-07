import {
    browserLocalPersistence,
    browserSessionPersistence,
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    sendPasswordResetEmail,
    setPersistence,
    signInWithEmailAndPassword,
    signOut,
} from 'firebase/auth';
import { doc, setDoc, serverTimestamp, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

function isEmail(value = '') {
    return value.includes('@');
}

function normalizeUsername(username = '') {
    return username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
}

function usernameToEmail(username = '') {
    const normalized = normalizeUsername(username);
    if (!normalized) {
        throw new Error('Invalid username. Use only letters, numbers, dot, underscore, or hyphen.');
    }
    return `${normalized}@users.clipboard.app`;
}

function pinToSecret(pin = '') {
    return `PIN-${pin.trim()}`;
}

function toFriendlyAuthError(error) {
    const code = error?.code ?? '';
    const map = {
        'auth/invalid-credential': 'Incorrect username/email or password/pincode.',
        'auth/user-not-found': 'Account not found.',
        'auth/wrong-password': 'Incorrect username/email or password/pincode.',
        'auth/invalid-email': 'Invalid email or username.',
        'auth/email-already-in-use': 'This account already exists.',
        'auth/weak-password': 'Pincode must contain at least 4 digits.',
        'auth/too-many-requests': 'Too many attempts. Please try again in a few minutes.',
        'auth/network-request-failed': 'Network error. Please check your connection.'
    };
    return map[code] || 'Authentication failed. Please try again.';
}

export const AUTH_PERSISTENCE_KEY = 'clipboard-vault-keep-signed-in';

export function loadKeepSignedInPreference() {
    const raw = localStorage.getItem(AUTH_PERSISTENCE_KEY);
    return raw === null ? true : raw === 'true';
}

export function saveKeepSignedInPreference(value) {
    localStorage.setItem(AUTH_PERSISTENCE_KEY, String(Boolean(value)));
}

export async function configureAuthPersistence(keepSignedIn) {
    const persistence = keepSignedIn ? browserLocalPersistence : browserSessionPersistence;
    await setPersistence(auth, persistence);
}

/**
 * Creates a user profile document in Firestore if it doesn't exist.
 * This is called upon user registration.
 * @param {User} user - The user object from Firebase Auth.
 * @param {object} additionalData - Additional data to store.
 */
const createUserProfileDocument = async (user, additionalData = {}) => {
    if (!user) return;

    const userRef = doc(db, `users/${user.uid}`);
    const snapshot = await getDoc(userRef);

    if (!snapshot.exists()) {
        const { email } = user;
        const createdAt = serverTimestamp();
        try {
            await setDoc(userRef, {
                email,
                createdAt,
                lastLoginAt: createdAt,
                plan: 'free',
                displayName: user.displayName || email.split('@')[0],
                ...additionalData,
            });
        } catch (error) {
            console.error('Error creating user profile', error);
            throw error;
        }
    }
    return userRef;
};

export const signUpWithEmailPassword = async (email, password, options = {}) => {
    try {
        const keepSignedIn = options.keepSignedIn ?? loadKeepSignedInPreference();
        await configureAuthPersistence(keepSignedIn);
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await createUserProfileDocument(userCredential.user);
        return userCredential;
    } catch (error) {
        throw new Error(toFriendlyAuthError(error));
    }
};

export const signUpWithUsernamePin = async (username, pin, options = {}) => {
    const normalized = normalizeUsername(username);
    if (normalized.length < 3) {
        throw new Error('Username must be at least 3 characters.');
    }
    if (!/^\d{4,8}$/.test(pin)) {
        throw new Error('Pincode must be between 4 and 8 digits.');
    }

    try {
        const keepSignedIn = options.keepSignedIn ?? loadKeepSignedInPreference();
        await configureAuthPersistence(keepSignedIn);
        const email = usernameToEmail(normalized);
        const password = pinToSecret(pin);
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await createUserProfileDocument(userCredential.user, {
            username: normalized,
            displayName: normalized
        });
        return userCredential;
    } catch (error) {
        throw new Error(toFriendlyAuthError(error));
    }
};

/**
 * Signs in a user and updates their last login timestamp.
 * @param {string} identifier - Email or username
 * @param {string} secret - Password or pincode
 * @returns {Promise<UserCredential>}
 */
export const signInWithEmailPassword = async (identifier, secret, options = {}) => {
    try {
        const keepSignedIn = options.keepSignedIn ?? loadKeepSignedInPreference();
        await configureAuthPersistence(keepSignedIn);
        const email = isEmail(identifier) ? identifier.trim() : usernameToEmail(identifier);
        const password = isEmail(identifier) ? secret : pinToSecret(secret);
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const userRef = doc(db, `users/${userCredential.user.uid}`);
        await updateDoc(userRef, {
            lastLoginAt: serverTimestamp()
        });
        return userCredential;
    } catch (error) {
        throw new Error(toFriendlyAuthError(error));
    }
};

export const signOutUser = () => signOut(auth);

export const sendPasswordReset = async (email) => {
    if (!isEmail(email)) {
        throw new Error('Use a real account email to reset password.');
    }
    try {
        await sendPasswordResetEmail(auth, email);
    } catch (error) {
        throw new Error(toFriendlyAuthError(error));
    }
};

/**
 * Sets up a listener for authentication state changes.
 * @param {function} callback - Function to call with the user object or null.
 * @returns {Unsubscribe} - The unsubscribe function.
 */
export const onAuthStateChange = (callback) => {
    return onAuthStateChanged(auth, callback);
};

export const getUserProfile = async (uid) => {
    const userRef = doc(db, `users/${uid}`);
    const snapshot = await getDoc(userRef);
    return snapshot.exists() ? snapshot.data() : null;
};

export const loadUserPreferences = async (uid) => {
    const userRef = doc(db, `users/${uid}`);
    const snapshot = await getDoc(userRef);
    if (!snapshot.exists()) return null;
    const profile = snapshot.data() || {};
    return profile.preferences || null;
};

export const saveUserPreferences = async (uid, preferences) => {
    const userRef = doc(db, `users/${uid}`);
    await setDoc(
        userRef,
        {
            preferences: preferences || {},
            updatedAt: serverTimestamp()
        },
        { merge: true }
    );
};

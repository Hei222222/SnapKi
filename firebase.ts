import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyA9p6yHBzcO9VPT-MmWQlyg6wlAY6ANyEY",
  authDomain: "snapki-b1a95.firebaseapp.com",
  projectId: "snapki-b1a95",
  storageBucket: "snapki-b1a95.firebasestorage.app",
  messagingSenderId: "105869301377",
  appId: "1:105869301377:web:ae88394401ad4c69959f80",
  measurementId: "G-9V2LVCTQF4"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export async function signInWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOutUser() {
  await auth.signOut();
}

export function getCurrentUser() {
  return auth.currentUser;
}
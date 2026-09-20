import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export type CloudBackup = {
  transactions: unknown[];
  favorites: unknown[];
  monthlyBudget: number;
  categoryBudgets: Record<string, number>;
  merchantMemories: unknown[];
  updatedAt?: unknown;
};

function backupRef(userId: string) {
  return doc(db, 'users', userId, 'private', 'snapkiBackup');
}

export async function uploadCloudBackup(
  userId: string,
  backup: Omit<CloudBackup, 'updatedAt'>
): Promise<void> {
  await setDoc(
    backupRef(userId),
    {
      ...backup,
      updatedAt: serverTimestamp(),
      schemaVersion: 1,
    },
    { merge: true }
  );
}

export async function downloadCloudBackup(
  userId: string
): Promise<CloudBackup | null> {
  const snapshot = await getDoc(backupRef(userId));

  if (!snapshot.exists()) {
    return null;
  }

  return snapshot.data() as CloudBackup;
}
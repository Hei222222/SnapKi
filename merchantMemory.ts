import AsyncStorage from '@react-native-async-storage/async-storage';
import { LearnedMerchantCategory } from './merchantMemoryTypes';

const STORAGE_KEY = '@snapki_merchant_memory_v1';

export function normalizeMerchantName(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s&.-]/gu, '');
}

export async function getMerchantMemories(): Promise<
  LearnedMerchantCategory[]
> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (item): item is LearnedMerchantCategory =>
        typeof item?.normalizedMerchant === 'string' &&
        typeof item?.merchantLabel === 'string' &&
        typeof item?.category === 'string' &&
        typeof item?.updatedAt === 'string'
    );
  } catch {
    return [];
  }
}

export async function saveMerchantMemory(
  merchant: string,
  category: string
): Promise<LearnedMerchantCategory[]> {
  const normalizedMerchant = normalizeMerchantName(merchant);

  if (!normalizedMerchant || !category) {
    return getMerchantMemories();
  }

  const memories = await getMerchantMemories();

  const newMemory: LearnedMerchantCategory = {
    normalizedMerchant,
    merchantLabel: merchant.trim(),
    category,
    updatedAt: new Date().toISOString(),
  };

  const withoutOldMemory = memories.filter(
    (item) => item.normalizedMerchant !== normalizedMerchant
  );

  const updatedMemories = [newMemory, ...withoutOldMemory];

  await AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(updatedMemories)
  );

  return updatedMemories;
}

export async function forgetMerchantMemory(
  merchant: string
): Promise<LearnedMerchantCategory[]> {
  const normalizedMerchant = normalizeMerchantName(merchant);
  const memories = await getMerchantMemories();

  const updatedMemories = memories.filter(
    (item) => item.normalizedMerchant !== normalizedMerchant
  );

  await AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(updatedMemories)
  );

  return updatedMemories;
}

export function findMerchantMemory(
  merchant: string,
  memories: LearnedMerchantCategory[]
): LearnedMerchantCategory | undefined {
  const normalizedMerchant = normalizeMerchantName(merchant);

  if (!normalizedMerchant) {
    return undefined;
  }

  return memories.find(
    (item) => item.normalizedMerchant === normalizedMerchant
  );
}
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { findMerchantMemory, forgetMerchantMemory, getMerchantMemories, saveMerchantMemory } from './merchantMemory';
import { LearnedMerchantCategory } from './merchantMemoryTypes';
import { auth, signInWithGoogle, signOutUser } from './firebase';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  downloadCloudBackup,
  uploadCloudBackup,
} from './firestoreBackup';

type TransactionType = 'expense' | 'income';
type ExpenseCategory = '飲食' | '交通' | '購物' | '娛樂' | '帳單' | '醫療' | '住屋' | '其他';
type IncomeCategory = '薪金' | '兼職' | '退款' | '朋友還款' | '投資收益' | '其他收入';
type Category = ExpenseCategory | IncomeCategory;
type PaymentMethod = 'Apple Pay' | '信用卡' | 'AlipayHK' | 'WeChat Pay HK' | '現金' | '銀行轉帳' | 'FPS' | '其他';
type TabName = '總覽' | '記帳' | '報表' | '預算';
type CategoryBudgets = Partial<Record<ExpenseCategory, number>>;

type Transaction = { id: string; merchant: string; amount: number; date: string; category: Category; paymentMethod: PaymentMethod; source: string; type: TransactionType };
type Favorite = { id: string; merchant: string; amount: number; category: Category; paymentMethod: PaymentMethod; type: TransactionType };
type CategoryInfo = { icon: string; color: string; soft: string };

type FormProps = {
  initialTransaction?: Transaction;
  merchantMemories: LearnedMerchantCategory[];
  onScanReceipt: () => void;
  isScanningReceipt: boolean;
  onRememberMerchant: (
    merchant: string,
    category: Category
  ) => Promise<void>;
  onSave: (value: Omit<Transaction, 'id'>) => void;
  onDelete?: () => void;
  saveLabel?: string;
  isReceiptDraft?: boolean;
};
const STORAGE_TRANSACTIONS = '@snapki_transactions_v4';
const STORAGE_BUDGET = '@snapki_budget_v4';
const STORAGE_FAVORITES = '@snapki_favorites_v1';
const STORAGE_CATEGORY_BUDGETS = '@snapki_category_budgets_v1';

const expenseCategories: ExpenseCategory[] = ['飲食', '交通', '購物', '娛樂', '帳單', '醫療', '其他'];
const incomeCategories: IncomeCategory[] = ['薪金', '兼職', '退款', '朋友還款', '投資收益', '其他收入'];
const paymentMethods: PaymentMethod[] = ['Apple Pay', '信用卡', 'AlipayHK', 'WeChat Pay HK', '現金', '銀行轉帳', 'FPS', '其他'];
const categoryInfo: Record<Category, CategoryInfo> = {
  飲食: { icon: '🍜', color: '#FF7A00', soft: '#FFF0E3' },
  交通: { icon: '🚇', color: '#0A84FF', soft: '#E6F2FF' },
  購物: { icon: '🛍️', color: '#AF52DE', soft: '#F6E9FC' },
  娛樂: { icon: '🎮', color: '#FF2D55', soft: '#FFE8EE' },
  帳單: { icon: '🧾', color: '#8E8E93', soft: '#F0F0F2' },
  醫療: { icon: '💊', color: '#22A06B', soft: '#E4F7EE' },
  住屋: { icon: '🏠', color: '#5E5CE6', soft: '#EDEDFF' },  // ← 加入這行
  其他: { icon: '🏷️', color: '#5E5CE6', soft: '#EDEDFF' },
  薪金: { icon: '💼', color: '#22A06B', soft: '#E4F7EE' },
  兼職: { icon: '🧑‍💻', color: '#00A3A3', soft: '#E2F8F8' },
  退款: { icon: '↩️', color: '#34C759', soft: '#E5F8EA' },
  朋友還款: { icon: '🤝', color: '#30B0C7', soft: '#E3F7FB' },
  投資收益: { icon: '📈', color: '#16A34A', soft: '#E7F8EA' },
  其他收入: { icon: '💰', color: '#52A447', soft: '#EAF7E7' },
};

function formatMoney(value: number): string { return `HK$${value.toLocaleString('en-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function dateKey(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function dateLabel(value: string): string { return value.replace(/-/g, '/'); }
function isCurrentMonth(value: string): boolean { const now = new Date(); const [year, month] = value.split('-').map(Number); return year === now.getFullYear() && month === now.getMonth() + 1; }
function monthKey(value: string): string { return value.slice(0, 7); }
function classifyExpenseMerchant(value: string): ExpenseCategory { const merchant = value.toLowerCase(); if (/mtr|港鐵|kmb|九巴|citybus|城巴|bus|巴士|uber|taxi|的士/.test(merchant)) return '交通'; if (/starbucks|mcdonald|麥當勞|restaurant|cafe|coffee|餐廳|茶餐廳|food|食/.test(merchant)) return '飲食'; if (/watsons|mannings|hktvmall|apple store|mall|shop|market|超市|便利店/.test(merchant)) return '購物'; if (/netflix|cinema|戲院|movie|game|playstation/.test(merchant)) return '娛樂'; if (/clinic|hospital|pharmacy|診所|醫院|藥房/.test(merchant)) return '醫療'; if (/rent|租金|電費|水費|煤氣|電訊|電話|internet|網絡/.test(merchant)) return '帳單'; return '其他'; }
function normalizeTransaction(item: unknown): Transaction { const value = item as Partial<Transaction>; return { id: value.id || `${Date.now()}-${Math.random()}`, merchant: value.merchant || '未命名交易', amount: Number(value.amount) || 0, date: value.date || dateKey(new Date()), category: value.category || '其他', paymentMethod: value.paymentMethod || '其他', source: value.source || '手動新增', type: value.type === 'income' ? 'income' : 'expense' }; }
function normalizeFavorite(item: unknown): Favorite { const value = item as Partial<Favorite>; return { id: value.id || `${Date.now()}-${Math.random()}`, merchant: value.merchant || '未命名常用交易', amount: Number(value.amount) || 0, category: value.category || '其他', paymentMethod: value.paymentMethod || '其他', type: value.type === 'income' ? 'income' : 'expense' }; }
function makeId(): string { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }

export default function App() {
  const [activeTab, setActiveTab] = useState<TabName>('總覽');
  const [user, setUser] = useState<User | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [monthlyBudget, setMonthlyBudget] = useState(0);
  const [categoryBudgets, setCategoryBudgets] = useState<CategoryBudgets>({});
  const [merchantMemories, setMerchantMemories] = useState<LearnedMerchantCategory[]>([]);
  const [ready, setReady] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [receiptDraft, setReceiptDraft] = useState<Transaction | null>(null);
  const [showFavoriteModal, setShowFavoriteModal] = useState(false);
  const [showMemoryModal, setShowMemoryModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [isScanningReceipt, setIsScanningReceipt] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [editingFavorite, setEditingFavorite] = useState<Favorite | null>(null);

  useEffect(() => { void loadData(); }, []);
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
    });

    return unsubscribe;
  }, []);
  useEffect(() => { if (ready) void AsyncStorage.setItem(STORAGE_TRANSACTIONS, JSON.stringify(transactions)); }, [transactions, ready]);
  useEffect(() => { if (ready) void AsyncStorage.setItem(STORAGE_FAVORITES, JSON.stringify(favorites)); }, [favorites, ready]);
  useEffect(() => { if (ready) void AsyncStorage.setItem(STORAGE_BUDGET, String(monthlyBudget)); }, [monthlyBudget, ready]);
  useEffect(() => { if (ready) void AsyncStorage.setItem(STORAGE_CATEGORY_BUDGETS, JSON.stringify(categoryBudgets)); }, [categoryBudgets, ready]);

  async function loadData(): Promise<void> {
    try {
      const [savedTransactions, savedFavorites, savedBudget, savedCategoryBudgets, memories] = await Promise.all([AsyncStorage.getItem(STORAGE_TRANSACTIONS), AsyncStorage.getItem(STORAGE_FAVORITES), AsyncStorage.getItem(STORAGE_BUDGET), AsyncStorage.getItem(STORAGE_CATEGORY_BUDGETS), getMerchantMemories()]);
      if (savedTransactions) { const parsed: unknown = JSON.parse(savedTransactions); setTransactions(Array.isArray(parsed) ? parsed.map(normalizeTransaction) : []); }
      if (savedFavorites) { const parsed: unknown = JSON.parse(savedFavorites); setFavorites(Array.isArray(parsed) ? parsed.map(normalizeFavorite) : []); }
      if (savedBudget) setMonthlyBudget(Number(savedBudget) || 0);
      if (savedCategoryBudgets) { const parsed = JSON.parse(savedCategoryBudgets) as Record<string, unknown>; const safe: CategoryBudgets = {}; expenseCategories.forEach((category) => { const amount = Number(parsed[category]); if (Number.isFinite(amount) && amount > 0) safe[category] = amount; }); setCategoryBudgets(safe); }
      setMerchantMemories(memories);
    } catch { Alert.alert('讀取資料失敗', '暫時未能讀取本機記帳資料。'); } finally { setReady(true); }
  }

  async function rememberMerchant(merchant: string, category: Category): Promise<void> { if (merchant.trim()) setMerchantMemories(await saveMerchantMemory(merchant, category)); }
  async function forgetMerchant(merchant: string): Promise<void> { setMerchantMemories(await forgetMerchantMemory(merchant)); }
  function addTransaction(value: Omit<Transaction, 'id'>): void { setTransactions((current) => [{ id: makeId(), ...value }, ...current]); }
  function addFavorite(value: Omit<Favorite, 'id'>): void { setFavorites((current) => [{ id: makeId(), ...value }, ...current]); }
  function updateTransaction(value: Transaction): void { setTransactions((current) => current.map((item: Transaction) => item.id === value.id ? value : item)); }
  function updateFavorite(value: Favorite): void { setFavorites((current) => current.map((item: Favorite) => item.id === value.id ? value : item)); }
  function deleteTransaction(id: string): void { setTransactions((current) => current.filter((item: Transaction) => item.id !== id)); setEditingTransaction(null); }
  function deleteFavorite(id: string): void { setFavorites((current) => current.filter((item: Favorite) => item.id !== id)); setEditingFavorite(null); }
  function clearAllData(): void {
    const confirmed = window.confirm(
      '確定要清除所有本機資料嗎？\n\n這會刪除：\n• 所有交易\n• 所有常用交易\n• 總月預算\n• 分類預算\n• 智慧分類記憶\n\n此動作不能還原。'
    );

    if (!confirmed) {
      return;
    }

    setTransactions([]);
    setFavorites([]);
    setMonthlyBudget(0);
    setCategoryBudgets({});
    setMerchantMemories([]);

    void AsyncStorage.multiRemove([
      STORAGE_TRANSACTIONS,
      STORAGE_FAVORITES,
      STORAGE_BUDGET,
      STORAGE_CATEGORY_BUDGETS,
      '@snapki_transactions_v3',
      '@snapki_budget_v3',
      '@snapki_transactions_v2',
      '@snapki_budget_v2',
      '@snapki_transactions_v1',
      '@snapki_budget_v1',
      '@snapki_merchant_memory_v1',
    ]);

    setShowSettingsModal(false);
    setShowMemoryModal(false);

    Alert.alert(
      '已清除',
      '本機交易、常用交易、預算及分類記憶已清除。'
    );
  }
  async function backupToCloud(): Promise<void> {
    if (!user) {
      Alert.alert('請先登入', '請先以 Google 登入才可以備份資料。');
      return;
    }

    try {
      await uploadCloudBackup(user.uid, {
        transactions,
        favorites,
        monthlyBudget,
        categoryBudgets,
        merchantMemories,
      });

      Alert.alert('備份完成', '你的資料已安全備份到雲端。');
    } catch (error) {
      console.error('雲端備份失敗：', error);
      Alert.alert('備份失敗', '未能上傳資料，請檢查網路後再試。');
    }
  }

  async function restoreFromCloud(): Promise<void> {
    if (!user) {
      Alert.alert('請先登入', '請先以 Google 登入才可以還原資料。');
      return;
    }

    const confirmed = window.confirm(
      '確定要從雲端還原嗎？\n\n目前裝置上的交易、常用交易、預算和分類記憶將會被雲端備份覆蓋。此動作不能還原。'
    );

    if (!confirmed) {
      return;
    }

    try {
      const backup = await downloadCloudBackup(user.uid);

      if (!backup) {
        Alert.alert(
          '找不到備份',
          '此 Google 帳戶目前還沒有 Snap記雲端備份。'
        );
        return;
      }

      setTransactions(
        Array.isArray(backup.transactions)
          ? (backup.transactions as Transaction[])
          : []
      );

      setFavorites(
        Array.isArray(backup.favorites)
          ? (backup.favorites as Favorite[])
          : []
      );

      setMonthlyBudget(Number(backup.monthlyBudget) || 0);

      setCategoryBudgets(
        backup.categoryBudgets &&
          typeof backup.categoryBudgets === 'object'
          ? (backup.categoryBudgets as CategoryBudgets)
          : {}
      );

      setMerchantMemories(
        Array.isArray(backup.merchantMemories)
          ? (backup.merchantMemories as LearnedMerchantCategory[])
          : []
      );

      Alert.alert('還原完成', '已從雲端還原你的 Snap記資料。');
    } catch (error) {
      console.error('雲端還原失敗：', error);
      Alert.alert('還原失敗', '未能讀取雲端備份，請檢查網路後再試。');
    }

    function scanReceipt(): void {
      Alert.alert(
        '掃描收據',
        '下一步會加入圖片選擇和 Azure 辨識功能。'
      );
    }
  }

  const monthTransactions = useMemo<Transaction[]>(() => transactions.filter((item: Transaction) => isCurrentMonth(item.date)), [transactions]);
  const monthIncome = useMemo<number>(() => monthTransactions.filter((item: Transaction) => item.type === 'income').reduce((sum: number, item: Transaction) => sum + item.amount, 0), [monthTransactions]);
  const monthExpense = useMemo<number>(() => monthTransactions.filter((item: Transaction) => item.type === 'expense').reduce((sum: number, item: Transaction) => sum + item.amount, 0), [monthTransactions]);
  const monthBalance = monthIncome - monthExpense;
  const todayExpense = transactions.filter((item: Transaction) => item.type === 'expense' && item.date === dateKey(new Date())).reduce((sum: number, item: Transaction) => sum + item.amount, 0);
  const categoryTotals = useMemo<Record<ExpenseCategory, number>>(() => { const result = Object.fromEntries(expenseCategories.map((category) => [category, 0])) as Record<ExpenseCategory, number>; monthTransactions.filter((item: Transaction) => item.type === 'expense').forEach((item: Transaction) => { result[item.category as ExpenseCategory] += item.amount; }); return result; }, [monthTransactions]);
  const topCategory = useMemo<{ category: ExpenseCategory; amount: number }>(() => expenseCategories.map((category: ExpenseCategory) => ({ category, amount: categoryTotals[category] })).sort((a, b) => b.amount - a.amount)[0], [categoryTotals]);
  const sortedTransactions = useMemo<Transaction[]>(() => [...transactions].sort((a: Transaction, b: Transaction) => `${b.date}${b.id}`.localeCompare(`${a.date}${a.id}`)), [transactions]);
  async function scanReceipt(): Promise<void> {
    setIsScanningReceipt(true);

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1,
        base64: true,
      });

      if (result.canceled) {
        setIsScanningReceipt(false);
        return;
      }

      const image = result.assets[0];

      if (!image.base64) {
        window.alert('無法讀取圖片內容，請選擇另一張 JPG 或 PNG 圖片。');
        setIsScanningReceipt(false);
        return;
      }

      const dataUrl = `data:image/jpeg;base64,${image.base64}`;

      console.log('收據圖片前綴：', dataUrl.slice(0, 40));
      console.log('收據圖片字元數：', dataUrl.length);

      const response = await fetch(
        '/.netlify/functions/scan-receipt',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            imageDataUrl: dataUrl,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok || data.error) {
        window.alert(`辨識失敗：${data.error || '無法辨識圖片，請重試。'}`);
        return;
      }

      const draft = data.draft;

      if (!draft) {
        window.alert('辨識結果不完整，請再試一次。');
        return;
      }

      const expenseCategoryValues: ExpenseCategory[] = [
        '交通',
        '飲食',
        '購物',
        '娛樂',
        '醫療',
        '住屋',
        '其他',
      ];

      const paymentMethodValues: PaymentMethod[] = [
        'Apple Pay',
        'AlipayHK',
        'WeChat Pay HK',
        'FPS',
      ];

      const category: ExpenseCategory = expenseCategoryValues.includes(
        draft.category as ExpenseCategory
      )
        ? (draft.category as ExpenseCategory)
        : '其他';

      const paymentMethod: PaymentMethod = paymentMethodValues.includes(
        draft.paymentMethod as PaymentMethod
      )
        ? (draft.paymentMethod as PaymentMethod)
        : 'Apple Pay';

      setReceiptDraft({
        id: `receipt-draft-${Date.now()}`,
        merchant: draft.merchant || '',
        amount: Number(draft.amount) || 0,
        date: /^\d{4}-\d{2}-\d{2}$/.test(draft.date || '')
          ? draft.date
          : dateKey(new Date()),
        category,
        paymentMethod,
        source: '收據辨識',
        type: 'expense',
      });

      setShowAddModal(true);

      window.alert('辨識完成，已自動填入新增記帳表單；請核對後按「儲存」。');
    } catch (error) {
      console.error('掃描收據失敗：', error);
      window.alert('掃描過程發生錯誤，請重試。');
    } finally {
      setIsScanningReceipt(false);
    }
  }
  if (!ready) return <SafeAreaView style={styles.safeArea}><StatusBar barStyle="dark-content" /><View style={styles.loading}><Text style={styles.loadingText}>正在開啟 Snap記…</Text></View></SafeAreaView>;
  return <SafeAreaView style={styles.safeArea}><StatusBar barStyle="dark-content" /><View style={styles.app}>{activeTab === '總覽' && <HomeScreen monthIncome={monthIncome} monthExpense={monthExpense} monthBalance={monthBalance} todayExpense={todayExpense} monthCount={monthTransactions.length} transactions={sortedTransactions} favorites={favorites} topCategory={topCategory} onAdd={() => setShowAddModal(true)} onAddFavorite={() => setShowFavoriteModal(true)} onUseFavorite={(favorite: Favorite) => addTransaction({ merchant: favorite.merchant, amount: favorite.amount, date: dateKey(new Date()), category: favorite.category, paymentMethod: favorite.paymentMethod, source: '常用交易', type: favorite.type })} onEditFavorite={(favorite: Favorite) => setEditingFavorite(favorite)} onDemoApplePay={() => addTransaction({ merchant: 'MTR Corporation', amount: 12, date: dateKey(new Date()), category: '交通', paymentMethod: 'Apple Pay', source: 'Apple Pay Shortcut（模擬）', type: 'expense' })} onEdit={(item: Transaction) => setEditingTransaction(item)} onOpenSettings={() => setShowSettingsModal(true)} onOpenMemories={() => setShowMemoryModal(true)} />}{activeTab === '記帳' && (
    <AddEditTransactionScreen
      key="manual-add"
      initialTransaction={undefined}
      isReceiptDraft={false}
      merchantMemories={merchantMemories}
      onScanReceipt={scanReceipt}
      isScanningReceipt={isScanningReceipt}
      onRememberMerchant={rememberMerchant}
      onSave={(value) => {
        addTransaction(value);
        setActiveTab('總覽');
      }}
    />
  )}{activeTab === '報表' && <ReportsScreen transactions={transactions} monthIncome={monthIncome} monthExpense={monthExpense} monthBalance={monthBalance} categoryTotals={categoryTotals} monthCount={monthTransactions.length} />}{activeTab === '預算' && <BudgetScreen monthExpense={monthExpense} monthlyBudget={monthlyBudget} categoryTotals={categoryTotals} categoryBudgets={categoryBudgets} onSaveBudget={setMonthlyBudget} onSaveCategoryBudgets={setCategoryBudgets} />}</View><BottomNavigation activeTab={activeTab} onChange={setActiveTab} /><Pressable style={styles.fab} onPress={() => setShowAddModal(true)}><Text style={styles.fabText}>＋</Text></Pressable>

    <Modal
      visible={showSettingsModal}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <SafeAreaView style={styles.modalSafeArea}>
        <ModalHeader
          title="設定"
          onClose={() => setShowSettingsModal(false)}
        />

        <SettingsScreen
          onOpenMemories={() => {
            setShowSettingsModal(false);
            setShowMemoryModal(true);
          }}
          onClearAllData={() => {
            setShowSettingsModal(false);
            clearAllData();
          }}
          onSignInGoogle={() => {
            void signInWithGoogle().catch((error) => {
              console.error('Google 登入失敗：', error);
              Alert.alert(
                '登入失敗',
                '未能完成 Google 登入，請確認 Firebase 的 Google 登入已啟用，然後再試一次。'
              );
            });
          }}
          onSignOut={() => {
            void signOutUser().catch((error) => {
              console.error('Google 登出失敗：', error);
              Alert.alert('登出失敗', '請稍後再試。');
            });
          }}
          onBackupToCloud={() => {
            void backupToCloud();
          }}
          onRestoreFromCloud={() => {
            void restoreFromCloud();
          }}
          user={user}
        />
      </SafeAreaView>
    </Modal>
    <Modal visible={showMemoryModal} animationType="slide" presentationStyle="pageSheet"><SafeAreaView style={styles.modalSafeArea}><ModalHeader title="已記住的分類" onClose={() => setShowMemoryModal(false)} /><MemoryList memories={merchantMemories} onForget={forgetMerchant} /></SafeAreaView></Modal>
    <Modal
      visible={showAddModal}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        setShowAddModal(false);
        setReceiptDraft(null);
      }}
    >
      <SafeAreaView style={styles.modalSafeArea}>
        <ModalHeader
          title="新增記帳"
          onClose={() => {
            setShowAddModal(false);
            setReceiptDraft(null);
          }}
        />

        <AddEditTransactionScreen
          key={receiptDraft?.id ?? 'manual-add'}
          initialTransaction={receiptDraft ?? undefined}
          isReceiptDraft={receiptDraft !== null}
          merchantMemories={merchantMemories}
          onScanReceipt={scanReceipt}
          isScanningReceipt={isScanningReceipt}
          onRememberMerchant={rememberMerchant}
          onSave={(value) => {
            addTransaction(value);
            setShowAddModal(false);
            setReceiptDraft(null);
            setActiveTab('總覽');
            Alert.alert('已儲存', '交易已加入本機記帳資料。');
          }}
        />
      </SafeAreaView>
    </Modal>
    <Modal visible={editingTransaction !== null} animationType="slide" presentationStyle="pageSheet"><SafeAreaView style={styles.modalSafeArea}><ModalHeader title="編輯交易" onClose={() => setEditingTransaction(null)} />{editingTransaction && (
      <AddEditTransactionScreen
        initialTransaction={editingTransaction}
        merchantMemories={merchantMemories}
        onScanReceipt={scanReceipt}
        isScanningReceipt={isScanningReceipt}
        onRememberMerchant={rememberMerchant}
        saveLabel="儲存修改"
        onSave={(value) => {
          updateTransaction(value as Transaction);
          setEditingTransaction(null);
        }}
        onDelete={() => {
          if (editingTransaction) {
            deleteTransaction(editingTransaction.id);
          }
        }}
      />
    )}</SafeAreaView></Modal>
    <Modal visible={showFavoriteModal} animationType="slide" presentationStyle="pageSheet"><SafeAreaView style={styles.modalSafeArea}><ModalHeader title="新增常用交易" onClose={() => setShowFavoriteModal(false)} /><FavoriteEditorScreen onSave={(value) => { addFavorite(value); setShowFavoriteModal(false); }} /></SafeAreaView></Modal>
    <Modal visible={editingFavorite !== null} animationType="slide" presentationStyle="pageSheet"><SafeAreaView style={styles.modalSafeArea}><ModalHeader title="編輯常用交易" onClose={() => setEditingFavorite(null)} />{editingFavorite && <FavoriteEditorScreen initialFavorite={editingFavorite} saveLabel="儲存修改" onSave={(value) => { updateFavorite(value as Favorite); setEditingFavorite(null); }} onDelete={() => { if (editingFavorite) deleteFavorite(editingFavorite.id); }} />}</SafeAreaView></Modal>
  </SafeAreaView>;
}

function ModalHeader({ title, onClose }: { title: string; onClose: () => void }): React.JSX.Element { return <View style={styles.modalHeader}><Text style={styles.modalTitle}>{title}</Text><Pressable onPress={onClose}><Text style={styles.modalClose}>完成</Text></Pressable></View>; }
function SettingsScreen({
  onOpenMemories,
  onClearAllData,
  onSignInGoogle,
  onSignOut,
  onBackupToCloud,
  onRestoreFromCloud,
  user,
}: {
  onOpenMemories: () => void;
  onClearAllData: () => void;
  onSignInGoogle: () => void;
  onSignOut: () => void;
  onBackupToCloud: () => void;
  onRestoreFromCloud: () => void;
  user: User | null;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.settingsScrollContent}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.settingsSectionTitle}>智慧功能</Text>

      <Pressable
        style={styles.settingsRow}
        onPress={onOpenMemories}
      >
        <View style={styles.settingsRowLeft}>
          <View style={styles.settingsIconMemory}>
            <Text style={styles.settingsIconText}>✦</Text>
          </View>

          <View>
            <Text style={styles.settingsRowTitle}>智慧分類記憶</Text>
            <Text style={styles.settingsRowDescription}>
              查看或刪除已記住的商戶分類
            </Text>
          </View>
        </View>

        <Text style={styles.settingsChevron}>›</Text>
      </Pressable>
      <Text style={styles.settingsSectionTitle}>帳戶</Text>

      {user ? (
        <View style={styles.settingsRow}>
          <View style={styles.settingsRowLeft}>
            <View style={styles.settingsIconMemory}>
              <Text style={styles.settingsIconText}>👤</Text>
            </View>

            <View style={styles.settingsAccountText}>
              <Text style={styles.settingsRowTitle}>
                {user.displayName || 'Google 帳戶'}
              </Text>
              <Text style={styles.settingsRowDescription}>
                {user.email || '已登入'}
              </Text>
            </View>
          </View>

          <Pressable
            onPress={onSignOut}
            style={styles.settingsSignOutButton}
          >
            <Text style={styles.settingsSignOutText}>登出</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          style={styles.settingsRow}
          onPress={onSignInGoogle}
        >
          <View style={styles.settingsRowLeft}>
            <View style={styles.settingsGoogleIcon}>
              <Text style={styles.settingsGoogleIconText}>G</Text>
            </View>

            <View style={styles.settingsAccountText}>
              <Text style={styles.settingsRowTitle}>以 Google 登入</Text>
              <Text style={styles.settingsRowDescription}>
                登入後可啟用雲端備份與同步
              </Text>
            </View>
          </View>

          <Text style={styles.settingsChevron}>›</Text>
        </Pressable>
      )}{user && (
        <>
          <Text style={styles.settingsSectionTitle}>雲端備份</Text>

          <View style={styles.settingsCloudCard}>
            <Text style={styles.settingsCloudTitle}>Google 雲端備份</Text>
            <Text style={styles.settingsCloudText}>
              手動儲存目前資料，或在新裝置還原最近一次備份。
            </Text>

            <View style={styles.settingsCloudActions}>
              <Pressable
                style={styles.settingsBackupButton}
                onPress={onBackupToCloud}
              >
                <Text style={styles.settingsBackupButtonText}>立即備份</Text>
              </Pressable>

              <Pressable
                style={styles.settingsRestoreButton}
                onPress={onRestoreFromCloud}
              >
                <Text style={styles.settingsRestoreButtonText}>從雲端還原</Text>
              </Pressable>
            </View>
          </View>
        </>
      )}
      <Text style={styles.settingsSectionTitle}>資料管理</Text>

      <View style={styles.settingsInfoCard}>
        <Text style={styles.settingsInfoTitle}>資料只儲存在目前裝置</Text>
        <Text style={styles.settingsInfoText}>
          清除瀏覽器資料、換裝置或使用不同瀏覽器後，交易資料不會自動同步。
        </Text>
      </View>

      <Pressable
        style={styles.settingsDangerButton}
        onPress={onClearAllData}
      >
        <Text style={styles.settingsDangerText}>清除所有本機資料</Text>
      </Pressable>

      <Text style={styles.settingsFooter}>
        Snap記 · 個人記帳測試版
      </Text>
    </ScrollView>
  );
}

type HomeScreenProps = { monthIncome: number; monthExpense: number; monthBalance: number; todayExpense: number; monthCount: number; transactions: Transaction[]; favorites: Favorite[]; topCategory: { category: ExpenseCategory; amount: number }; onAdd: () => void; onAddFavorite: () => void; onUseFavorite: (favorite: Favorite) => void; onEditFavorite: (favorite: Favorite) => void; onDemoApplePay: () => void; onEdit: (item: Transaction) => void; onOpenSettings: () => void; onOpenMemories: () => void };
function HomeScreen({ monthIncome, monthExpense, monthBalance, todayExpense, monthCount, transactions, favorites, topCategory, onAdd, onAddFavorite, onUseFavorite, onEditFavorite, onDemoApplePay, onEdit, onOpenSettings, onOpenMemories }: HomeScreenProps): React.JSX.Element { const [searchText, setSearchText] = useState<string>(''); const visibleTransactions: Transaction[] = transactions.filter((item: Transaction) => `${item.merchant} ${item.category} ${item.paymentMethod}`.toLowerCase().includes(searchText.toLowerCase())); return <ScrollView style={styles.homeScroll} contentContainerStyle={styles.homeScrollContent} keyboardShouldPersistTaps="handled"><View style={styles.headerRow}><View><Text style={styles.title}>Snap記</Text><Text style={styles.subtitle}>{new Intl.DateTimeFormat('zh-HK', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())}</Text></View><View style={styles.headerActions}><Pressable onPress={onOpenMemories} style={styles.headerActionButton}><Text style={styles.headerActionText}>✦</Text></Pressable><Pressable onPress={onOpenSettings} style={styles.settingsButton}><Text style={styles.settingsText}>⚙︎</Text></Pressable></View></View><View style={styles.summaryCard}><Text style={styles.summaryLabel}>本月結餘</Text><Text style={styles.summaryAmount}>{formatMoney(monthBalance)}</Text><View style={styles.summaryStats}><View><Text style={styles.summarySmallLabel}>本月收入</Text><Text style={styles.summarySmallAmount}>+{formatMoney(monthIncome)}</Text></View><View><Text style={styles.summarySmallLabel}>本月支出</Text><Text style={styles.summarySmallAmount}>-{formatMoney(monthExpense)}</Text></View></View></View><View style={styles.miniStatsRow}><View style={styles.miniStatCard}><Text style={styles.miniStatLabel}>今日支出</Text><Text style={styles.miniStatValue}>{formatMoney(todayExpense)}</Text></View><View style={styles.miniStatCard}><Text style={styles.miniStatLabel}>本月交易</Text><Text style={styles.miniStatValue}>{monthCount} 筆</Text></View></View>{topCategory.amount > 0 && <View style={styles.insightCard}><Text style={styles.insightIcon}>{categoryInfo[topCategory.category].icon}</Text><View><Text style={styles.insightTitle}>本月最大支出：{topCategory.category}</Text><Text style={styles.insightText}>{formatMoney(topCategory.amount)}</Text></View></View>}<View style={styles.sectionHeader}><Text style={styles.sectionTitle}>常用交易</Text><Pressable onPress={onAddFavorite}><Text style={styles.addLink}>＋ 新增</Text></Pressable></View><ScrollView horizontal>{favorites.map((favorite: Favorite) => <Pressable key={favorite.id} onPress={() => onUseFavorite(favorite)} onLongPress={() => onEditFavorite(favorite)} style={styles.favoriteCard}><Text style={styles.favoriteIcon}>{categoryInfo[favorite.category].icon}</Text><Text style={styles.favoriteName}>{favorite.merchant}</Text><Text style={styles.favoriteAmount}>{formatMoney(favorite.amount)}</Text></Pressable>)}<Pressable style={styles.addFavoriteCard} onPress={onAddFavorite}><Text style={styles.addFavoriteText}>＋ 新增</Text></Pressable></ScrollView><Text style={styles.sectionTitle}>快速記帳</Text><View style={styles.quickRow}><Pressable style={styles.quickCard} onPress={onAdd}><Text style={styles.quickIcon}>＋</Text><Text style={styles.quickTitle}>新增收支</Text></Pressable><Pressable style={styles.quickCard} onPress={onDemoApplePay}><Text style={styles.quickIcon}>🍎</Text><Text style={styles.quickTitle}>模擬 Apple Pay</Text></Pressable></View><Text style={styles.sectionTitle}>最近交易</Text><View style={styles.searchBox}><Text style={styles.searchIcon}>⌕</Text><TextInput value={searchText} onChangeText={setSearchText} placeholder="搜尋商戶、分類或付款方式" placeholderTextColor="#93939A" style={styles.searchInput} /></View>{visibleTransactions.map((item: Transaction) => <Pressable key={item.id} onPress={() => onEdit(item)} style={styles.transactionRow}><Text style={styles.categoryIcon}>{categoryInfo[item.category].icon}</Text><View style={styles.transactionMiddle}><Text style={styles.transactionMerchant}>{item.merchant}</Text><Text style={styles.transactionMeta}>{item.category} · {item.paymentMethod}</Text></View><Text style={styles.transactionAmount}>{item.type === 'income' ? '+' : '-'}{formatMoney(item.amount)}</Text></Pressable>)}</ScrollView>; }

function AddEditTransactionScreen({
  initialTransaction,
  merchantMemories,
  onRememberMerchant,
  onSave,
  onDelete,
  saveLabel = '儲存',
  isReceiptDraft = false,
  onScanReceipt,
  isScanningReceipt,
}: FormProps): React.JSX.Element {
  const [type, setType] = useState<TransactionType>(initialTransaction?.type || 'expense');
  const [merchant, setMerchant] = useState<string>(initialTransaction?.merchant || '');
  const [amountText, setAmountText] = useState<string>(initialTransaction ? String(initialTransaction.amount) : '');
  const [date, setDate] = useState<string>(initialTransaction?.date || dateKey(new Date()));
  const [category, setCategory] = useState<Category>(initialTransaction?.category || '其他');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(initialTransaction?.paymentMethod || 'Apple Pay');
  const [remember, setRemember] = useState<boolean>(false);

  const suggestions: LearnedMerchantCategory[] = merchantMemories
    .filter((memory: LearnedMerchantCategory) =>
      merchant.trim() && memory.merchantLabel.toLowerCase().includes(merchant.toLowerCase())
    )
    .slice(0, 3);

  const save = async (): Promise<void> => {
    const amount = Number(amountText.replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert('金額不正確', '請輸入大於 0 的金額。');
      return;
    }

    const value: Omit<Transaction, 'id'> = {
      ...(initialTransaction || { id: makeId() }) as unknown as Omit<Transaction, 'id'>,
      merchant: merchant.trim() || '未命名交易',
      amount,
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : dateKey(new Date()),
      category,
      paymentMethod,
      source: initialTransaction?.source || '',
      type,
    };

    onSave(value);
    if (remember && type === 'expense') {
      await onRememberMerchant(value.merchant, category);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.keyboardAvoidingView} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.formScrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.formScreen}>
          <Text style={styles.title}>{isReceiptDraft
            ? '確認收據記帳'
            : initialTransaction
              ? '編輯記帳'
              : '新增記帳'}</Text>

          <Pressable
            style={styles.receiptScanButton}
            onPress={onScanReceipt}
            disabled={isScanningReceipt}
          >
            <Text style={styles.receiptScanIcon}>📷</Text>

            <View style={styles.receiptScanTextWrap}>
              <Text style={styles.receiptScanTitle}>
                {isScanningReceipt
                  ? '正在辨識收據…'
                  : '掃描收據／付款截圖'}
              </Text>

              <Text style={styles.receiptScanDescription}>
                {isScanningReceipt
                  ? '請稍候，完成後會自動帶入交易資料'
                  : '選擇圖片後，自動帶入交易資料'}
              </Text>
            </View>

            <Text style={styles.receiptScanChevron}>›</Text>
          </Pressable>

          <View style={styles.typeToggle}>
            <Pressable onPress={() => setType('expense')} style={type === 'expense' ? styles.typeButtonExpense : styles.typeButton}>
              <Text style={styles.typeButtonText}>支出</Text>
            </Pressable>
            <Pressable onPress={() => setType('income')} style={type === 'income' ? styles.typeButtonIncome : styles.typeButton}>
              <Text style={styles.typeButtonText}>收入</Text>
            </Pressable>
          </View>

          <View style={styles.formCard}>
            <Text style={styles.fieldLabel}>商戶名稱</Text>
            <TextInput
              value={merchant}
              onChangeText={setMerchant}
              style={styles.textInput}
              placeholder="例如：MTR、午餐"
              placeholderTextColor="#999"
            />

            {suggestions.map((item: LearnedMerchantCategory) => (
              <Pressable
                key={item.normalizedMerchant}
                onPress={() => {
                  setMerchant(item.merchantLabel);
                  setCategory(item.category as Category);
                }}
                style={styles.suggestionItem}
              >
                <Text>{categoryInfo[item.category as Category]?.icon} {item.merchantLabel} — {item.category}</Text>
              </Pressable>
            ))}

            <Text style={styles.fieldLabel}>金額（HK$）</Text>
            <TextInput
              value={amountText}
              onChangeText={setAmountText}
              style={styles.textInput}
              keyboardType="decimal-pad"
              placeholder="例如：12.00"
              placeholderTextColor="#999"
            />

            <Text style={styles.fieldLabel}>日期</Text>
            <TextInput
              value={date}
              onChangeText={setDate}
              style={styles.textInput}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#999"
            />

            {type === 'income' ? (
              <>
                <Text style={styles.formSectionTitle}>收入分類</Text>
                <View style={styles.chipWrap}>
                  {incomeCategories.map((item: IncomeCategory) => (
                    <Pressable
                      key={item}
                      onPress={() => setCategory(item)}
                      style={category === item ? styles.choiceChipSelected : styles.choiceChip}
                    >
                      <Text>{categoryInfo[item].icon} {item}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : (
              <>
                <Text style={styles.formSectionTitle}>支出分類</Text>
                <View style={styles.chipWrap}>
                  {expenseCategories.map((item: ExpenseCategory) => (
                    <Pressable
                      key={item}
                      onPress={() => setCategory(item)}
                      style={category === item ? styles.choiceChipSelected : styles.choiceChip}
                    >
                      <Text>{categoryInfo[item].icon} {item}</Text>
                    </Pressable>
                  ))}
                </View>

                {merchant.trim().length > 0 && (
                  <Pressable onPress={() => setRemember(!remember)} style={styles.rememberRow}>
                    <Text style={remember ? styles.rememberTextSelected : styles.rememberText}>
                      {remember ? '✓ 記住這個商戶分類' : '記住這個商戶分類'}
                    </Text>
                  </Pressable>
                )}

                <Text style={styles.formSectionTitle}>付款方式</Text>
                <View style={styles.chipWrap}>
                  {paymentMethods.map((item: PaymentMethod) => (
                    <Pressable
                      key={item}
                      onPress={() => setPaymentMethod(item)}
                      style={paymentMethod === item ? styles.choiceChipSelected : styles.choiceChip}
                    >
                      <Text>{item}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
          </View>

          <Pressable onPress={save} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>{saveLabel || '儲存交易'}</Text>
          </Pressable>

          {onDelete && (
            <Pressable
              onPress={() => {
                if (window.confirm('確定要刪除這筆交易嗎？')) {
                  onDelete();
                }
              }}
              style={styles.deleteButton}
            >
              <Text style={styles.deleteButtonText}>刪除交易</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
function FavoriteEditorScreen({ initialFavorite, onSave, onDelete, saveLabel = '儲存常用交易' }: { initialFavorite?: Favorite; onSave: (value: Omit<Favorite, 'id'> | Favorite) => void; onDelete?: () => void; saveLabel?: string }): React.JSX.Element { const [merchant, setMerchant] = useState<string>(initialFavorite?.merchant || ''); const [amountText, setAmountText] = useState<string>(initialFavorite ? String(initialFavorite.amount) : ''); const [category, setCategory] = useState<Category>(initialFavorite?.category || '其他'); const save = (): void => { const amount = Number(amountText); if (!Number.isFinite(amount) || amount <= 0) { Alert.alert('金額不正確', '請輸入大於 0 的金額。'); return; } onSave({ ...(initialFavorite || { id: makeId() }), merchant: merchant.trim() || '未命名常用交易', amount, category, paymentMethod: initialFavorite?.paymentMethod || 'Apple Pay', type: 'expense' }); }; return <ScrollView contentContainerStyle={styles.formScrollContent}><View style={styles.formScreen}><Text style={styles.title}>常用交易</Text><View style={styles.formCard}><Text style={styles.fieldLabel}>商戶名稱</Text><TextInput value={merchant} onChangeText={setMerchant} style={styles.textInput} placeholder="例如：MTR、午餐" placeholderTextColor="#999" /><Text style={styles.fieldLabel}>固定金額（HK$）</Text><TextInput value={amountText} onChangeText={setAmountText} style={styles.textInput} keyboardType="decimal-pad" /></View><View style={styles.chipWrap}>{expenseCategories.map((item: ExpenseCategory) => <Pressable key={item} onPress={() => setCategory(item)} style={category === item ? styles.choiceChipSelected : styles.choiceChip}><Text>{categoryInfo[item].icon} {item}</Text></Pressable>)}</View><Pressable onPress={save} style={styles.primaryButton}><Text style={styles.primaryButtonText}>{saveLabel}</Text></Pressable>{onDelete && <Pressable onPress={() => { if (window.confirm('確定要刪除這個常用項目嗎？')) onDelete(); }} style={styles.deleteButton}><Text style={styles.deleteButtonText}>刪除常用交易</Text></Pressable>}</View></ScrollView>; }

function MemoryList({ memories, onForget }: { memories: LearnedMerchantCategory[]; onForget: (merchant: string) => void }): React.JSX.Element { return <ScrollView contentContainerStyle={styles.memoryList}>{memories.length === 0 ? <Text style={styles.emptyTitle}>尚未記住任何分類</Text> : memories.map((memory: LearnedMerchantCategory) => <View key={memory.normalizedMerchant} style={styles.memoryRow}><Text style={styles.memoryIcon}>{categoryInfo[memory.category as Category]?.icon || '🏷️'}</Text><View style={styles.memoryMiddle}><Text style={styles.memoryMerchant}>{memory.merchantLabel}</Text><Text style={styles.memoryCategory}>{memory.category}</Text></View><Pressable onPress={() => onForget(memory.merchantLabel)}><Text style={styles.forgetText}>忘記</Text></Pressable></View>)}</ScrollView>; }

function ReportsScreen({ transactions, monthIncome, monthExpense, monthBalance, categoryTotals, monthCount }: { transactions: Transaction[]; monthIncome: number; monthExpense: number; monthBalance: number; categoryTotals: Record<ExpenseCategory, number>; monthCount: number }): React.JSX.Element { const rows = expenseCategories.map((category: ExpenseCategory) => ({ category, amount: categoryTotals[category] })).filter((row: { category: ExpenseCategory; amount: number }) => row.amount > 0); const monthly: Record<string, { income: number; expense: number }> = {}; transactions.forEach((item: Transaction) => { const key = monthKey(item.date); monthly[key] ||= { income: 0, expense: 0 }; monthly[key][item.type] += item.amount; }); const chartRows = Object.entries(monthly).sort(([a], [b]) => a.localeCompare(b)).slice(-6); const maximum = Math.max(1, ...chartRows.flatMap(([, value]) => [value.income, value.expense])); return <ScrollView contentContainerStyle={styles.reportScrollContent}><Text style={styles.title}>本月報表</Text><Text style={styles.subtitle}>收入、支出與消費分類總覽</Text><View style={styles.reportHero}><Text style={styles.reportHeroLabel}>本月結餘</Text><Text style={styles.reportHeroAmount}>{formatMoney(monthBalance)}</Text><Text style={styles.reportHeroCaption}>收入 +{formatMoney(monthIncome)}　支出 -{formatMoney(monthExpense)}</Text></View><View style={styles.reportMiniRow}><View style={styles.reportMiniCard}><Text style={styles.reportMiniLabel}>交易筆數</Text><Text style={styles.reportMiniValue}>{monthCount} 筆</Text></View><View style={styles.reportMiniCard}><Text style={styles.reportMiniLabel}>儲蓄率</Text><Text style={styles.reportMiniValue}>{monthIncome ? `${Math.round(monthBalance / monthIncome * 100)}%` : '—'}</Text></View></View><Text style={styles.sectionTitle}>近 6 個月趨勢</Text><View style={styles.trendCard}><Text style={styles.legend}><Text style={styles.legendIncome}>● 收入</Text>　<Text style={styles.legendExpense}>● 支出</Text></Text><View style={styles.trend}>{chartRows.map(([key, value]: [string, { income: number; expense: number }]) => <View key={key} style={styles.trendColumn}><View style={styles.trendBars}><View style={[styles.trendBar, { height: `${value.income / maximum * 100}%`, backgroundColor: '#22A06B' }]} /><View style={[styles.trendBar, { height: `${value.expense / maximum * 100}%`, backgroundColor: '#FF453A' }]} /></View><Text style={styles.trendMonthLabel}>{key.slice(5)}月</Text></View>)}</View></View><Text style={styles.sectionTitle}>支出分類</Text>{rows.map((row: { category: ExpenseCategory; amount: number }) => <View key={row.category} style={styles.reportRow}><Text>{categoryInfo[row.category].icon} {row.category}</Text><Text>{formatMoney(row.amount)}</Text></View>)}</ScrollView>; }

function BudgetScreen({ monthExpense, monthlyBudget, categoryTotals, categoryBudgets, onSaveBudget, onSaveCategoryBudgets }: { monthExpense: number; monthlyBudget: number; categoryTotals: Record<ExpenseCategory, number>; categoryBudgets: CategoryBudgets; onSaveBudget: (value: number) => void; onSaveCategoryBudgets: (value: CategoryBudgets) => void }): React.JSX.Element { const [totalText, setTotalText] = useState<string>(monthlyBudget ? String(monthlyBudget) : ''); const [texts, setTexts] = useState<Record<ExpenseCategory, string>>(() => Object.fromEntries(expenseCategories.map((category) => [category, categoryBudgets[category] ? String(categoryBudgets[category]) : ''])) as Record<ExpenseCategory, string>); function saveCategories(): void { const next: CategoryBudgets = {}; for (const category of expenseCategories) { const amount = Number(texts[category]); if (texts[category] && (!Number.isFinite(amount) || amount < 0)) { Alert.alert('預算不正確', `請檢查${category}預算。`); return; } if (amount > 0) next[category] = amount; } onSaveCategoryBudgets(next); Alert.alert('已儲存', '分類預算已更新。'); } return <ScrollView contentContainerStyle={styles.formScrollContent} keyboardShouldPersistTaps="handled"><View style={styles.formScreen}><Text style={styles.title}>預算</Text><View style={styles.formCard}><Text style={styles.fieldLabel}>本月支出總預算（HK$）</Text><TextInput value={totalText} onChangeText={setTotalText} keyboardType="decimal-pad" style={styles.textInput} /><Pressable onPress={() => onSaveBudget(Number(totalText) || 0)} style={styles.primaryButton}><Text style={styles.primaryButtonText}>儲存總預算</Text></Pressable><Text style={styles.budgetUsed}>已支出 {formatMoney(monthExpense)}{monthlyBudget ? ` ／ ${formatMoney(monthlyBudget)}` : ' ／ 未設定'}</Text></View><Text style={styles.formSectionTitle}>分類預算</Text>{expenseCategories.map((category: ExpenseCategory) => { const limit = categoryBudgets[category] || 0; const spent = categoryTotals[category] || 0; const ratio = limit ? spent / limit : 0; return <View key={category} style={styles.categoryBudget}><View style={styles.categoryBudgetTop}><Text>{categoryInfo[category].icon} {category}</Text><Text style={ratio > 1 ? styles.overBudget : ratio >= .8 ? styles.warningBudget : styles.goodBudget}>{limit ? ratio > 1 ? `超支 ${formatMoney(spent - limit)}` : `尚餘 ${formatMoney(limit - spent)}` : '未設定'}</Text></View>{limit > 0 && <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.min(ratio, 1) * 100}%` }, ratio > 1 && styles.progressOver, ratio >= .8 && ratio <= 1 && styles.progressWarning]} /></View>}<TextInput value={texts[category]} onChangeText={(value: string) => setTexts((current) => ({ ...current, [category]: value }))} keyboardType="decimal-pad" placeholder="輸入分類預算" placeholderTextColor="#999" style={styles.categoryBudgetInput} /></View>; })}<Pressable onPress={saveCategories} style={styles.primaryButton}><Text style={styles.primaryButtonText}>儲存分類預算</Text></Pressable></View></ScrollView>; }

function BottomNavigation({
  activeTab,
  onChange,
}: {
  activeTab: TabName;
  onChange: (tab: TabName) => void;
}): React.JSX.Element {
  return (
    <View style={styles.bottomNav}>
      {(['總覽', '記帳', '報表', '預算'] as TabName[]).map((tab) => (
        <Pressable
          key={tab}
          onPress={() => onChange(tab)}
          style={styles.navItem}
        >
          <Text
            style={[
              styles.navIcon,
              activeTab === tab && styles.navIconSelected,
            ]}
          >
            {tab === '總覽' && '⌂'}
            {tab === '記帳' && '✚'}
            {tab === '報表' && '▥'}
            {tab === '預算' && '⌘'}
          </Text>
          <Text
            style={[
              styles.navText,
              activeTab === tab && styles.navTextSelected,
            ]}
          >
            {tab === '總覽' && '首頁'}
            {tab === '記帳' && '新增'}
            {tab === '報表' && '報表'}
            {tab === '預算' && '預算'}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F5F7' },
  modalSafeArea: { flex: 1, backgroundColor: '#F5F5F7' },
  app: { flex: 1 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#6D6D73' },
  homeScroll: { flex: 1 },
  homeScrollContent: { padding: 18, paddingBottom: 120 },
  formScreen: { padding: 18 },
  formScrollContent: { paddingBottom: 130 },
  reportScrollContent: { padding: 18, paddingBottom: 120 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 17 },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerActionButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFF0D8', justifyContent: 'center', alignItems: 'center' },
  headerActionText: { fontSize: 22, color: '#A76700' },
  title: { fontSize: 30, fontWeight: '800', color: '#17171B' },
  subtitle: { marginTop: 4, fontSize: 14, color: '#74747B' },
  settingsButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#E7E7EC', justifyContent: 'center', alignItems: 'center' },
  settingsText: { fontSize: 22, color: '#33343A' },
  summaryCard: { backgroundColor: '#0A84FF', borderRadius: 24, padding: 22 },
  summaryLabel: { color: '#DDEFFF' },
  summaryAmount: { color: '#FFFFFF', fontSize: 34, fontWeight: '800', marginTop: 5 },
  summaryStats: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 18 },
  summaryRight: { alignItems: 'flex-end' },
  summarySmallLabel: { color: '#DDEFFF', fontSize: 12 },
  summarySmallAmount: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', marginTop: 3 },
  incomeText: { color: '#C9FFD7' },
  miniStatsRow: { flexDirection: 'row', gap: 11, marginTop: 12 },
  miniStatCard: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 17, padding: 14 },
  miniStatLabel: { color: '#77777E', fontSize: 12 },
  miniStatValue: { color: '#222228', fontSize: 17, fontWeight: '800', marginTop: 5 },
  insightCard: { marginTop: 12, borderRadius: 18, backgroundColor: '#FFFFFF', padding: 13, flexDirection: 'row', alignItems: 'center' },
  insightIcon: { fontSize: 26, marginRight: 11 },
  insightTitle: { color: '#27272C', fontSize: 14, fontWeight: '800' },
  insightText: { color: '#77777E', fontSize: 12, marginTop: 3 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 19, fontWeight: '800', color: '#17171B', marginTop: 24, marginBottom: 11 },
  addLink: { color: '#0A84FF', fontSize: 14, fontWeight: '800' },
  favoriteCard: { width: 128, minHeight: 140, borderRadius: 19, backgroundColor: '#FFFFFF', padding: 13, marginRight: 10 },
  favoriteIcon: { fontSize: 20 },
  favoriteName: { color: '#25252A', fontSize: 14, fontWeight: '800', marginTop: 10 },
  favoriteAmount: { color: '#202024', fontSize: 13, fontWeight: '800', marginTop: 5 },
  addFavoriteCard: { width: 105, minHeight: 140, borderRadius: 19, borderWidth: 1.5, borderColor: '#BDD9F6', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  addFavoriteText: { color: '#0A70D7', fontWeight: '800' },
  quickRow: { flexDirection: 'row', gap: 12 },
  quickCard: { flex: 1, minHeight: 112, backgroundColor: '#FFFFFF', borderRadius: 20, padding: 16 },
  quickIcon: { color: '#0A84FF', fontSize: 27, height: 34 },
  quickTitle: { color: '#202024', fontSize: 15, fontWeight: '800', marginTop: 7 },
  searchBox: { height: 45, backgroundColor: '#E9E9EE', borderRadius: 13, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  searchIcon: { fontSize: 23, color: '#73737A', marginRight: 7 },
  searchInput: { flex: 1, color: '#202024', fontSize: 14 },
  transactionList: { paddingBottom: 8 },
  transactionRow: { minHeight: 68, backgroundColor: '#FFFFFF', borderRadius: 18, padding: 12, flexDirection: 'row', alignItems: 'center', marginTop: 9 },
  categoryIcon: { fontSize: 20, marginRight: 10 },
  transactionMiddle: { flex: 1 },
  transactionMerchant: { color: '#202024', fontSize: 15, fontWeight: '700' },
  transactionMeta: { color: '#77777E', fontSize: 11, marginTop: 4 },
  transactionAmount: { color: '#202024', fontSize: 14, fontWeight: '800' },
  memoryList: { padding: 18 },
  memoryRow: { backgroundColor: '#FFFFFF', borderRadius: 17, padding: 12, flexDirection: 'row', alignItems: 'center', marginBottom: 9 },
  memoryIcon: { fontSize: 20, marginRight: 11 },
  memoryMiddle: { flex: 1 },
  memoryMerchant: { color: '#25252A', fontWeight: '800' },
  memoryCategory: { color: '#77777E', marginTop: 3 },
  forgetText: { color: '#D92D25', fontWeight: '800' },
  typeToggle: { marginTop: 18, flexDirection: 'row', backgroundColor: '#E7E7EC', borderRadius: 14, padding: 4, gap: 4 },
  typeButton: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 11 },
  typeButtonExpense: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 11, backgroundColor: '#FFFFFF' },
  typeButtonIncome: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 11, backgroundColor: '#E7F8EA' },
  typeButtonText: { color: '#1C1C20', fontSize: 15, fontWeight: '800' },
  formCard: { marginTop: 18, backgroundColor: '#FFFFFF', borderRadius: 20, padding: 16 },
  fieldLabel: { color: '#74747B', fontSize: 13, fontWeight: '700', marginTop: 4, marginBottom: 7 },
  textInput: { height: 48, borderWidth: 1, borderColor: '#E4E4E9', backgroundColor: '#FAFAFB', borderRadius: 12, paddingHorizontal: 13, color: '#19191D', fontSize: 16, marginBottom: 13 },
  suggestionItem: { backgroundColor: '#FAFAFB', padding: 10, borderRadius: 9, marginBottom: 5 },
  formSectionTitle: { color: '#1D1D22', fontSize: 16, fontWeight: '800', marginTop: 20, marginBottom: 10 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  choiceChip: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E1E1E6', borderRadius: 99, paddingHorizontal: 13, paddingVertical: 10 },
  choiceChipSelected: { borderColor: '#0A84FF', backgroundColor: '#EAF3FF', borderWidth: 1, borderRadius: 99, paddingHorizontal: 13, paddingVertical: 10 },
  rememberRow: { backgroundColor: '#FFF7DE', borderRadius: 15, padding: 12, marginTop: 18 },
  rememberText: { color: '#735000', fontSize: 14, fontWeight: '800' },
  rememberTextSelected: { color: '#15803D', fontSize: 14, fontWeight: '800' },
  receiptScanButton: { marginTop: 16, backgroundColor: '#EEF6FF', borderWidth: 1, borderColor: '#B9D9FB', borderRadius: 18, padding: 14, flexDirection: 'row', alignItems: 'center' },
  receiptScanIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#D9ECFF', color: '#0A70D7', fontSize: 20, textAlign: 'center', textAlignVertical: 'center', marginRight: 11 },
  receiptScanTextWrap: { flex: 1, minWidth: 0 },
  receiptScanTitle: { color: '#174A7B', fontSize: 15, fontWeight: '800' },
  receiptScanDescription: { color: '#4D78A0', fontSize: 12, lineHeight: 17, marginTop: 3 },
  receiptScanChevron: { color: '#377EC1', fontSize: 28, marginLeft: 10 },
  primaryButton: { marginTop: 24, height: 52, borderRadius: 15, backgroundColor: '#0A84FF', justifyContent: 'center', alignItems: 'center', marginBottom: 15 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  deleteButton: { height: 48, borderRadius: 14, backgroundColor: '#FFE9E8', justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  deleteButtonText: { color: '#D92D25', fontSize: 15, fontWeight: '800' },
  reportHero: { marginTop: 18, padding: 22, backgroundColor: '#171A3E', borderRadius: 24 },
  reportHeroLabel: { color: '#D9DDFF' },
  reportHeroAmount: { color: '#FFFFFF', fontSize: 34, fontWeight: '800', marginTop: 5 },
  reportHeroCaption: { color: '#CDD3FF', fontSize: 12, marginTop: 12 },
  reportMiniRow: { flexDirection: 'row', gap: 11, marginTop: 12 },
  reportMiniCard: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 17, padding: 14 },
  reportMiniLabel: { color: '#77777E', fontSize: 12 },
  reportMiniValue: { color: '#222228', fontSize: 17, fontWeight: '800', marginTop: 5 },
  legend: { marginBottom: 8 },
  legendIncome: { color: '#22A06B' },
  legendExpense: { color: '#FF453A' },
  trendCard: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 16, minHeight: 160 },
  trend: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around', height: 120 },
  trendColumn: { flex: 1, alignItems: 'center' },
  trendBars: { flexDirection: 'row', gap: 6, alignItems: 'flex-end', height: 100 },
  trendBar: { width: 14, borderRadius: 4, minHeight: 2 },
  trendMonthLabel: { color: '#77777E', fontSize: 11, marginTop: 8 },
  reportRow: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  budgetUsed: { color: '#77777E', marginTop: 10 },
  categoryBudget: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 14, marginBottom: 9 },
  categoryBudgetTop: { flexDirection: 'row', justifyContent: 'space-between' },
  categoryBudgetInput: { height: 42, borderWidth: 1, borderColor: '#E4E4E9', borderRadius: 10, paddingHorizontal: 10, marginTop: 10 },
  progressTrack: { height: 8, borderRadius: 99, backgroundColor: '#ECECF0', overflow: 'hidden', marginTop: 10 },
  progressFill: { height: '100%', backgroundColor: '#22A06B' },
  progressWarning: { backgroundColor: '#F59E0B' },
  progressOver: { backgroundColor: '#FF453A' },
  goodBudget: { color: '#15803D', fontSize: 12 },
  warningBudget: { color: '#B45309', fontSize: 12 },
  overBudget: { color: '#D92D25', fontSize: 12 },
  bottomNav: { height: 74, flexDirection: 'row', backgroundColor: '#FFFFFF', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E7E7EC', justifyContent: 'space-around', alignItems: 'center', paddingBottom: 6 },
  navItem: { minWidth: 64, alignItems: 'center', justifyContent: 'center', paddingTop: 6 },
  navIcon: { fontSize: 22, color: '#85858C', marginBottom: 2 },
  navIconSelected: { color: '#0A84FF' },
  navText: { color: '#85858C', fontSize: 11, fontWeight: '700', marginTop: 1 },
  navTextSelected: { color: '#0A84FF', fontSize: 11, fontWeight: '800' },
  modalHeader: { height: 54, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFFFFF', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E7E7EC' },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#1C1C20' },
  modalClose: { color: '#0A84FF', fontSize: 16, fontWeight: '700' },
  fab: { position: 'absolute', right: 22, bottom: 82, width: 58, height: 58, borderRadius: 29, backgroundColor: '#0A84FF', justifyContent: 'center', alignItems: 'center', elevation: 4 },
  fabText: { color: '#FFFFFF', fontSize: 30 },
  keyboardAvoidingView: { flex: 1 },
  emptyTitle: { color: '#242429', fontSize: 17, fontWeight: '800', textAlign: 'center', marginTop: 8 },
  settingsAccountText: { flex: 1, minWidth: 0 },
  settingsGoogleIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E5EA', alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  settingsGoogleIconText: { color: '#4285F4', fontSize: 21, fontWeight: '900' },
  settingsSignOutButton: { backgroundColor: '#F0F0F2', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, marginLeft: 10 },
  settingsSignOutText: { color: '#55555C', fontSize: 13, fontWeight: '800' },
  settingsScrollContent: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 56 },
  settingsSectionTitle: { color: '#17171B', fontSize: 16, fontWeight: '800', marginTop: 20, marginBottom: 10 },
  settingsRow: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 14, minHeight: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  settingsRowLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 },
  settingsIconMemory: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#FFF0D8', alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  settingsIconText: { color: '#A76700', fontSize: 21 },
  settingsRowTitle: { color: '#25252A', fontSize: 15, fontWeight: '800' },
  settingsRowDescription: { color: '#77777E', fontSize: 12, lineHeight: 17, marginTop: 3 },
  settingsChevron: { color: '#A7A7AE', fontSize: 28, marginLeft: 10 },
  settingsInfoCard: { backgroundColor: '#FFF7DE', borderRadius: 18, padding: 15 },
  settingsInfoTitle: { color: '#735000', fontSize: 14, fontWeight: '800' },
  settingsInfoText: { color: '#805F14', fontSize: 13, lineHeight: 19, marginTop: 6 },
  settingsDangerButton: { marginTop: 14, height: 50, borderRadius: 15, backgroundColor: '#FFE9E8', alignItems: 'center', justifyContent: 'center' },
  settingsDangerText: { color: '#D92D25', fontSize: 15, fontWeight: '800' },
  settingsFooter: { color: '#93939A', fontSize: 12, textAlign: 'center', marginTop: 30 },
  settingsCloudCard: { backgroundColor: '#EDF5FF', borderRadius: 18, padding: 15 },
  settingsCloudTitle: { color: '#1B5EAA', fontSize: 15, fontWeight: '800' },
  settingsCloudText: { color: '#4773A1', fontSize: 13, lineHeight: 19, marginTop: 6 },
  settingsCloudActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  settingsBackupButton: { flex: 1, height: 44, borderRadius: 13, backgroundColor: '#0A84FF', alignItems: 'center', justifyContent: 'center' },
  settingsBackupButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  settingsRestoreButton: { flex: 1, height: 44, borderRadius: 13, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#9DC8F5', alignItems: 'center', justifyContent: 'center' },
  settingsRestoreButtonText: { color: '#176DC2', fontSize: 13, fontWeight: '800' },
});

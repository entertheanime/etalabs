import { db } from '@/lib/firebase';
import { LEGACY_ESCROW_TRADE_ADDRESS, isAllowedTradeContract } from '@/lib/contracts';
import { runtimeChain } from '@/lib/networkPref';
import { 
  collection, 
  setDoc, 
  doc, 
  getDoc, 
  updateDoc, 
  serverTimestamp,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  startAfter,
  documentId,
  type QueryDocumentSnapshot
} from 'firebase/firestore';

const TRADE_LINK_PREFIX = 'ETA';
const TRADE_LINK_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TRADE_LINK_RANDOM_LEN = 8;

export function generateTradeLinkId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TRADE_LINK_RANDOM_LEN));
  let suffix = '';
  for (const byte of bytes) {
    suffix += TRADE_LINK_CHARS[byte % TRADE_LINK_CHARS.length];
  }
  return `${TRADE_LINK_PREFIX}${suffix}`;
}

export interface NFTItem {
  contract: string;
  tokenId: string;
  image?: string;
  name?: string;
  collectionName?: string;
  amount?: string;
  standard?: string;
  compressed?: boolean;
  updateAuthority?: string;
  creators?: Array<{
    address: string;
    share: number;
    verified: boolean;
  }>;
  attributes?: Array<{
    trait_type?: string;
    value: any;
  }>;
}

export interface TradeProposal {
  id?: string;
  from: string;
  to: string;
  offer: NFTItem[];
  requested: NFTItem[];
  offeredMonad?: string;
  requestedMonad?: string;
  offeredChog?: string;
  requestedChog?: string;
  offeredSol?: string;
  requestedSol?: string;
  message?: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired' | 'incomplete';
  createdAt: any;
  expiresAt?: any;
  blockchainTradeId?: string;
  tradeContract?: string;
  transactionHash?: string;
  tradeType?: 'stay-in-wallet' | 'proof-commitment' | 'escrow-program' | 'direct-transfer';
  network?: 'mainnet' | 'devnet' | 'localnet' | 'robinhood' | 'monad' | 'ink' | 'ethereum';
  totalcNFTs?: number;
  totalRegularNFTs?: number;
  counteredFrom?: string;
  counteredWith?: string;
  chainStatusUnknown?: boolean;
}

// Cache duration for offline mode
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

const TEST_NFT = '0xac8be86e6d0c62b084de090a88aafa25cd3740e2';
const STALE_NETWORKS = new Set(['devnet', 'mainnet', 'localnet', 'solana']);

function nftLooksLegacyMonad(nft: NFTItem) {
  const blob = `${nft.name || ''} ${nft.collectionName || ''} ${nft.image || ''} ${nft.contract || ''}`.toLowerCase();
  return blob.includes('molandak') || blob.includes('monad-testnet') || blob.includes('reservoir.tools');
}

export function isLegacyMonadTrade(trade: TradeProposal) {
  if (trade.network && STALE_NETWORKS.has(String(trade.network))) return true;
  const nfts = [...(trade.offer || []), ...(trade.requested || [])];
  return nfts.some(nftLooksLegacyMonad);
}

export async function proposeTrade({
  from,
  to,
  offer,
  requested,
  offeredMonad,
  requestedMonad,
  offeredChog,
  requestedChog,
  offeredSol,
  requestedSol,
  message,
  blockchainTradeId,
  tradeType,
  network,
  tradeContract,
  expiresAt,
  status,
  counteredFrom,
}: {
  from: string;
  to: string;
  offer: NFTItem[];
  requested: NFTItem[];
  offeredMonad?: string;
  requestedMonad?: string;
  offeredChog?: string;
  requestedChog?: string;
  offeredSol?: string;
  requestedSol?: string;
  message?: string;
  blockchainTradeId?: string;
  tradeType?: 'stay-in-wallet' | 'proof-commitment' | 'escrow-program' | 'direct-transfer';
  network?: 'mainnet' | 'devnet' | 'localnet' | 'robinhood' | 'monad' | 'ink' | 'ethereum';
  tradeContract?: string;
  expiresAt?: Date;
  status?: TradeProposal['status'];
  counteredFrom?: string;
}): Promise<string> {
  // Calculate NFT statistics
  const totalcNFTs = (offer?.filter(nft => nft.compressed)?.length || 0) + 
                     (requested?.filter(nft => nft.compressed)?.length || 0);
  const totalRegularNFTs = (offer?.filter(nft => !nft.compressed)?.length || 0) + 
                           (requested?.filter(nft => !nft.compressed)?.length || 0);
  
  // Use SOL values if provided, fallback to Monad for compatibility
  const finalOfferedAmount = offeredSol || offeredMonad || '0';
  const finalRequestedAmount = requestedSol || requestedMonad || '0';

  console.log('🚀 Starting proposeTrade with data:', {
    from,
    to,
    offerCount: offer?.length || 0,
    requestedCount: requested?.length || 0,
    offeredAmount: finalOfferedAmount,
    requestedAmount: finalRequestedAmount,
    message,
    blockchainTradeId,
    tradeType: tradeType || 'stay-in-wallet',
      network: network || 'robinhood',
    totalcNFTs,
    totalRegularNFTs
  });

  // Validate inputs
  if (!from || !to) {
    throw new Error('Both from and to addresses are required');
  }

  if ((!offer || offer.length === 0) && parseFloat(finalOfferedAmount) === 0 && parseFloat(offeredChog || '0') === 0) {
    throw new Error('Must offer at least one NFT, some MON, or some CHOG');
  }

  try {
    const tradeData: Omit<TradeProposal, 'id'> = {
      from: from.toLowerCase(),
      to: to.toLowerCase(),
      offer: offer || [],
      requested: requested || [],
      offeredMonad: finalOfferedAmount, // Keep for compatibility
      requestedMonad: finalRequestedAmount, // Keep for compatibility
      offeredChog: offeredChog || '0',
      requestedChog: requestedChog || '0',
      offeredSol: finalOfferedAmount, // More accurate field name
      requestedSol: finalRequestedAmount, // More accurate field name
      message: message || '',
      status: status || 'pending',
      createdAt: serverTimestamp(),
      expiresAt: expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000),
      tradeType: tradeType || 'stay-in-wallet',
      network: network || 'robinhood',
      totalcNFTs,
      totalRegularNFTs,
      ...(blockchainTradeId && { blockchainTradeId }),
      ...(tradeContract && { tradeContract }),
      ...(counteredFrom && { counteredFrom }),
    };

    console.log('Adding trade to Firestore...');
    for (let attempt = 0; attempt < 5; attempt++) {
      const tradeLinkId = generateTradeLinkId();
      const docRef = doc(db, 'trades', tradeLinkId);
      const existing = await getDoc(docRef);
      if (existing.exists()) continue;
      await setDoc(docRef, tradeData);
      console.log('✅ Trade added with ID:', tradeLinkId);
      if (tradeContract) {
        const { saveSharedTradeContract } = await import('@/lib/sharedTradeContract');
        await saveSharedTradeContract(tradeContract, runtimeChain().id);
      }
      return tradeLinkId;
    }
    throw new Error('Could not allocate a unique ETA trade link');
  } catch (error) {
    console.error('Error in proposeTrade:', {
      error,
      errorMessage: error.message,
      errorCode: error.code,
      errorStack: error.stack
    });
    throw error;
  }
}

function sameTokenList(a: NFTItem[] = [], b: NFTItem[] = []) {
  if (a.length !== b.length) return false;
  return a.every((nft) =>
    b.some(
      (item) =>
        (item.contract || '').toLowerCase() === (nft.contract || '').toLowerCase() &&
        String(item.tokenId) === String(nft.tokenId)
    )
  );
}

function sameOnChainTrade(firebaseTrade: TradeProposal, chainTrade: TradeProposal) {
  return (
    firebaseTrade.from?.toLowerCase() === chainTrade.from?.toLowerCase() &&
    firebaseTrade.to?.toLowerCase() === chainTrade.to?.toLowerCase() &&
    sameTokenList(firebaseTrade.offer, chainTrade.offer) &&
    sameTokenList(firebaseTrade.requested, chainTrade.requested)
  );
}

function retainTradePresentation(
  chainNfts: NFTItem[] = [],
  savedNfts: NFTItem[] = []
): NFTItem[] {
  return chainNfts.map((chainNft) => {
    const saved = savedNfts.find(
      (nft) =>
        nft.contract?.toLowerCase() === chainNft.contract?.toLowerCase() &&
        String(nft.tokenId) === String(chainNft.tokenId)
    );

    // The contract is the source of truth for which NFT is in an offer, while
    // Firestore retains the display data captured when the offer was created.
    return {
      ...chainNft,
      name: chainNft.name?.startsWith('#') ? saved?.name || chainNft.name : chainNft.name,
      image: chainNft.image || saved?.image || '',
    };
  });
}

export async function getTrade(tradeId: string, opts?: { local?: boolean }): Promise<TradeProposal | null> {
  if (typeof window !== 'undefined' && !opts?.local) {
    try {
      const res = await fetch(`/api/trade?id=${encodeURIComponent(String(tradeId))}`);
      if (res.ok) {
        const data = (await res.json()) as { trade?: TradeProposal | null };
        return data.trade ?? null;
      }
    } catch {
      /* read locally if the API is down */
    }
  }

  let firebaseTrade: TradeProposal | null = null;
  try {
    const docRef = doc(db, 'trades', tradeId);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      const data = { id: docSnap.id, ...docSnap.data() } as TradeProposal;
      if (isLegacyMonadTrade(data)) return null;
      firebaseTrade = data;
    } else if (/^\d+$/.test(String(tradeId))) {
      const snaps = await getDocs(
        query(collection(db, 'trades'), where('blockchainTradeId', '==', String(tradeId)), limit(5))
      );
      for (const snap of snaps.docs) {
        const data = { id: snap.id, ...snap.data() } as TradeProposal;
        if (!isLegacyMonadTrade(data)) {
          firebaseTrade = data;
          break;
        }
      }
    }
  } catch (error) {
    console.warn('Firebase trade lookup failed, trying chain:', error);
  }

  const chained = String(tradeId).match(/^(0x[a-fA-F0-9]{40})-(\d+)$/i);
  const chainId = chained
    ? chained[2]
    : firebaseTrade?.blockchainTradeId || (/^\d+$/.test(tradeId) ? tradeId : '');
  const rawPreferred = chained?.[1] || firebaseTrade?.tradeContract;
  const { getEscrowAddress, isAllowedEscrowContract } = await import('@/lib/escrow');
  const escrowAddr = (getEscrowAddress() || '').toLowerCase();
  const preferredContract =
    rawPreferred &&
    (isAllowedEscrowContract(rawPreferred) || isAllowedTradeContract(rawPreferred))
      ? rawPreferred
      : undefined;
  const looksEscrow =
    firebaseTrade?.tradeType === 'escrow-program' ||
    (preferredContract && escrowAddr && preferredContract.toLowerCase() === escrowAddr);
  if (chainId && looksEscrow) {
    try {
      const { getEscrowOnChainTrade } = await import('@/services/escrow');
      const chainTrade = await getEscrowOnChainTrade(String(chainId), preferredContract);
      if (chainTrade) {
        const merged = {
          ...(firebaseTrade || {}),
          ...chainTrade,
          id: firebaseTrade?.id || chainTrade.id,
          offer: retainTradePresentation(chainTrade.offer as any, firebaseTrade?.offer),
          requested: retainTradePresentation(chainTrade.requested as any, firebaseTrade?.requested),
          chainStatusUnknown: false,
        } as TradeProposal;
        if (
          firebaseTrade?.id &&
          firebaseTrade.status !== chainTrade.status &&
          chainTrade.status !== 'pending' &&
          chainTrade.status !== 'incomplete'
        ) {
          updateTradeStatus(firebaseTrade.id, chainTrade.status as 'accepted' | 'declined' | 'cancelled' | 'expired').catch(
            () => undefined
          );
        }
        return merged;
      }
    } catch {
      if (!firebaseTrade) return null;
      return {
        ...firebaseTrade,
        chainStatusUnknown: true,
      };
    }
  }
  if (chainId) {
    const { getOnChainTrade, findContractWithTrade } = await import('@/services/blockchain');
    try {
      const contractAddress = await findContractWithTrade(String(chainId), preferredContract);
      const chainTrade = await getOnChainTrade(String(chainId), contractAddress);
      if (chainTrade) {
        if (firebaseTrade && !sameOnChainTrade(firebaseTrade, chainTrade)) {
          return {
            ...firebaseTrade,
            ...chainTrade,
            id: firebaseTrade.id,
            offer: retainTradePresentation(chainTrade.offer, firebaseTrade.offer),
            requested: retainTradePresentation(chainTrade.requested, firebaseTrade.requested),
            chainStatusUnknown: false,
          };
        }
        const merged = {
          ...firebaseTrade,
          ...chainTrade,
          id: firebaseTrade?.id || chainTrade.id,
          blockchainTradeId: String(chainId),
          tradeContract: chainTrade.tradeContract || firebaseTrade?.tradeContract,
          status: chainTrade.status,
          offer: retainTradePresentation(chainTrade.offer, firebaseTrade?.offer),
          requested: retainTradePresentation(chainTrade.requested, firebaseTrade?.requested),
        } as TradeProposal;
        if (
          firebaseTrade?.id &&
          sameOnChainTrade(firebaseTrade, chainTrade) &&
          firebaseTrade.status !== chainTrade.status &&
          chainTrade.status !== 'pending'
        ) {
          updateTradeStatus(firebaseTrade.id, chainTrade.status as 'accepted' | 'declined' | 'cancelled' | 'expired').catch(
            () => undefined
          );
        }
        return { ...merged, chainStatusUnknown: false };
      }
      if (firebaseTrade) {
        return { ...firebaseTrade, chainStatusUnknown: true };
      }
    } catch {
      if (firebaseTrade) {
        return { ...firebaseTrade, chainStatusUnknown: true };
      }
    }
  }

  if (chainId && escrowAddr && !looksEscrow) {
    try {
      const { getEscrowOnChainTrade } = await import('@/services/escrow');
      const escrowTrade = await getEscrowOnChainTrade(String(chainId), escrowAddr);
      if (escrowTrade && !firebaseTrade) return escrowTrade as TradeProposal;
    } catch {
      /* stay with firebase */
    }
  }

  if (firebaseTrade?.status === 'pending' && isTradeExpired(firebaseTrade.expiresAt)) {
    return { ...firebaseTrade, status: 'expired' };
  }
  return firebaseTrade;
}

export async function updateTradeStatus(
  tradeId: string, 
  status: 'accepted' | 'declined' | 'cancelled' | 'expired' | 'incomplete' | 'pending',
  additionalData?: Record<string, any>
): Promise<void> {
  const updateData = {
    status,
    updatedAt: serverTimestamp(),
    ...additionalData
  };

  try {
    const directRef = doc(db, 'trades', tradeId);
    const directSnap = await getDoc(directRef);
    if (directSnap.exists()) {
      await updateDoc(directRef, updateData);
      return;
    }

    const tradesRef = collection(db, 'trades');
    const [byString, byNumber] = await Promise.all([
      getDocs(query(tradesRef, where('blockchainTradeId', '==', String(tradeId)), limit(5))),
      /^\d+$/.test(tradeId)
        ? getDocs(query(tradesRef, where('blockchainTradeId', '==', Number(tradeId)), limit(5)))
        : Promise.resolve({ empty: true, docs: [] as any[] }),
    ]);
    const docs = [...byString.docs, ...('docs' in byNumber ? byNumber.docs : [])];
    const unique = new Map(docs.map((snap) => [snap.id, snap]));
    if (unique.size) {
      await Promise.all([...unique.values()].map((snap) => updateDoc(snap.ref, updateData)));
      return;
    }

    console.warn('No Firebase trade doc for', tradeId, '— chain status is enough');
  } catch (error) {
    console.warn('Firebase trade status skipped:', error);
  }
}

async function getFirebaseUserTrades(userAddress: string): Promise<TradeProposal[]> {
  try {
    const tradesRef = collection(db, 'trades');
    const normalized = userAddress.toLowerCase();
    const [createdSnap, receivedSnap] = await Promise.all([
      getDocs(query(tradesRef, where('from', '==', normalized))),
      getDocs(query(tradesRef, where('to', '==', normalized))),
    ]);
    const trades = new Map<string, TradeProposal>();
    createdSnap.forEach((snap) => {
      trades.set(snap.id, { id: snap.id, ...snap.data() } as TradeProposal);
    });
    receivedSnap.forEach((snap) => {
      if (!trades.has(snap.id)) {
        trades.set(snap.id, { id: snap.id, ...snap.data() } as TradeProposal);
      }
    });
    return Array.from(trades.values());
  } catch (error) {
    console.warn('Firebase user trades unavailable:', error);
    return [];
  }
}

export async function getUserTrades(userAddress: string): Promise<TradeProposal[]> {
  const { getOnChainUserTrades } = await import('@/services/blockchain');
  const firebaseTrades = await getFirebaseUserTrades(userAddress);
  const { getEscrowAddress } = await import('@/lib/escrow');
  const escrowAddr = (getEscrowAddress() || '').toLowerCase();
  const extraContracts = [
    ...new Set(
      firebaseTrades
        .map((trade) => trade.tradeContract)
        .filter((addr): addr is string => Boolean(addr))
        .filter((addr) => addr.toLowerCase() !== LEGACY_ESCROW_TRADE_ADDRESS)
        .filter((addr) => !escrowAddr || addr.toLowerCase() !== escrowAddr)
        .filter((addr) => isAllowedTradeContract(addr))
    ),
  ];
  let chainFailed = false;
  let chainTrades: Awaited<ReturnType<typeof getOnChainUserTrades>>['trades'] = [];
  try {
    const listed = await getOnChainUserTrades(userAddress, extraContracts);
    chainTrades = listed.trades;
    chainFailed = !listed.complete;
  } catch {
    chainFailed = true;
  }

  const firebaseByChainId = new Map<string, TradeProposal>();
  for (const trade of firebaseTrades) {
    if (trade.blockchainTradeId) {
      const key = `${(trade.tradeContract || '').toLowerCase()}-${String(trade.blockchainTradeId)}`;
      firebaseByChainId.set(key, trade);
    }
  }

  const merged = new Map<string, TradeProposal>();
  for (const chainTrade of chainTrades) {
    const firebaseTrade = firebaseByChainId.get(
      `${(chainTrade.tradeContract || '').toLowerCase()}-${chainTrade.blockchainTradeId}`
    );
    const sameNfts = firebaseTrade && sameOnChainTrade(firebaseTrade, chainTrade as TradeProposal);
    merged.set(chainTrade.id, {
      ...chainTrade,
      id: sameNfts && firebaseTrade?.id ? firebaseTrade.id : chainTrade.id,
      status: chainTrade.status,
      from: chainTrade.from,
      to: chainTrade.to,
      // Keep the NFT artwork captured when the offer was made. The chain only
      // stores asset IDs, so replacing these with on-chain data loses images.
      offer: retainTradePresentation(chainTrade.offer, firebaseTrade?.offer),
      requested: retainTradePresentation(chainTrade.requested, firebaseTrade?.requested),
      offeredMonad: chainTrade.offeredMonad,
      requestedMonad: chainTrade.requestedMonad,
      offeredChog: chainTrade.offeredChog,
      requestedChog: chainTrade.requestedChog,
      blockchainTradeId: chainTrade.blockchainTradeId,
      tradeContract: chainTrade.tradeContract,
      createdAt: firebaseTrade?.createdAt || chainTrade.createdAt,
      expiresAt: chainTrade.expiresAt || firebaseTrade?.expiresAt,
    } as TradeProposal);
  }

  for (const trade of firebaseTrades) {
    if (isLegacyMonadTrade(trade)) continue;
    const chainKey = `${(trade.tradeContract || '').toLowerCase()}-${String(trade.blockchainTradeId || '')}`;
    const already = [...merged.values()].some((item) => {
      const itemKey = `${(item.tradeContract || '').toLowerCase()}-${String(item.blockchainTradeId || '')}`;
      if (trade.blockchainTradeId && item.blockchainTradeId) {
        return itemKey === chainKey;
      }
      return item.id && trade.id && item.id === trade.id;
    });
    if (already) continue;
    if (trade.id) {
      merged.set(trade.id, chainFailed ? { ...trade, chainStatusUnknown: true } : trade);
    }
  }

  return Array.from(merged.values())
    .filter((trade) => !isLegacyMonadTrade(trade))
    .sort((a, b) => {
      // On-chain trades use Date, while older Firebase records use Timestamp.
      // Treat missing/unreadable dates as oldest so an "Unknown" item never
      // jumps above a verified, recently created offer.
      const timestamp = (value: unknown) => {
        if (value instanceof Date) return value.getTime();
        if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
          return (value as { toDate: () => Date }).toDate().getTime();
        }
        if (value && typeof (value as { seconds?: unknown }).seconds === 'number') {
          return (value as { seconds: number }).seconds * 1000;
        }
        if (typeof value === 'number') return value > 1e12 ? value : value * 1000;
        if (typeof value === 'string') {
          const parsed = new Date(value).getTime();
          return Number.isNaN(parsed) ? 0 : parsed;
        }
        return 0;
      };
      return timestamp(b.createdAt) - timestamp(a.createdAt);
    });
}

// Offline mode functionality
let isOffline = false;
let offlineCache: { [key: string]: { data: any; timestamp: number } } = {};

export function setOfflineMode(offline: boolean) {
  isOffline = offline;
  console.log('Offline mode:', offline ? 'enabled' : 'disabled');
}

function isCacheValid(timestamp: number): boolean {
  return Date.now() - timestamp < CACHE_DURATION;
}

function getCachedData(key: string): any {
  const cached = offlineCache[key];
  if (cached && isCacheValid(cached.timestamp)) {
    console.log('📦 Using cached data for:', key);
    return cached.data;
  }
  return null;
}

function setCacheData(key: string, data: any): void {
  offlineCache[key] = {
    data,
    timestamp: Date.now()
  };
}

// Admin functions
export async function getAllTradesForAdmin(filters?: {
  status?: string[];
  limit?: number;
  offset?: number;
}): Promise<{ trades: TradeProposal[]; total: number; hasMore: boolean }> {
  try {
    const tradesRef = collection(db, 'trades');
    let q = query(tradesRef, orderBy('createdAt', 'desc'));
    
    // Apply status filter if provided
    if (filters?.status && filters.status.length > 0) {
      q = query(tradesRef, where('status', 'in', filters.status), orderBy('createdAt', 'desc'));
    }
    
    // Apply limit
    if (filters?.limit) {
      q = query(q, limit(filters.limit));
    }
    
    const querySnapshot = await getDocs(q);
    const trades: TradeProposal[] = [];
    
    querySnapshot.forEach((doc) => {
      trades.push({
        id: doc.id,
        ...doc.data()
      } as TradeProposal);
    });
    
    return {
      trades,
      total: trades.length,
      hasMore: false // Simple implementation, could be enhanced with pagination
    };
  } catch (error) {
    console.error('Error getting all trades for admin:', error);
    throw error;
  }
}

export type TraderWalletRow = {
  address: string;
  offered: number;
  received: number;
  completed: number;
  accepted: number;
};

/** Unique from/to wallets on offer docs. Connect-only is not stored. */
export async function getTraderWalletsForWhitelist(): Promise<TraderWalletRow[]> {
  const tradesRef = collection(db, 'trades');
  const wallets = new Map<string, { offered: number; received: number; completed: number; accepted: number }>();
  let cursor: QueryDocumentSnapshot | undefined;
  for (;;) {
    const page = await getDocs(
      cursor
        ? query(tradesRef, orderBy(documentId()), limit(100), startAfter(cursor))
        : query(tradesRef, orderBy(documentId()), limit(100))
    );
    if (page.empty) break;
    for (const snap of page.docs) {
      const data = snap.data();
      const from = String(data.from || '').toLowerCase();
      const to = String(data.to || '').toLowerCase();
      const completed = data.status === 'accepted' ? 1 : 0;
      if (from.startsWith('0x') && from.length === 42) {
        const row = wallets.get(from) || { offered: 0, received: 0, completed: 0, accepted: 0 };
        row.offered += 1;
        row.completed += completed;
        wallets.set(from, row);
      }
      if (to.startsWith('0x') && to.length === 42) {
        const row = wallets.get(to) || { offered: 0, received: 0, completed: 0, accepted: 0 };
        row.received += 1;
        row.completed += completed;
        row.accepted += completed;
        wallets.set(to, row);
      }
    }
    cursor = page.docs[page.docs.length - 1];
    if (page.size < 100) break;
  }
  return [...wallets.entries()]
    .map(([address, counts]) => ({ address, ...counts }))
    .sort((a, b) => b.completed - a.completed || b.offered + b.received - (a.offered + a.received));
}

export function traderWalletsToCsv(rows: TraderWalletRow[]) {
  const header = 'address,offered,received,completed,accepted';
  const body = rows.map((row) => `${row.address},${row.offered},${row.received},${row.completed},${row.accepted}`);
  return [header, ...body].join('\n');
}

export function isEligibleTrader(row: Pick<TraderWalletRow, 'offered' | 'accepted' | 'completed'>) {
  return row.offered > 0 || row.accepted > 0 || row.completed > 0;
}

export async function getTraderWalletRow(address: string): Promise<TraderWalletRow> {
  const normalized = address.toLowerCase();
  const empty: TraderWalletRow = { address: normalized, offered: 0, received: 0, completed: 0, accepted: 0 };
  if (!normalized.startsWith('0x') || normalized.length !== 42) return empty;
  const tradesRef = collection(db, 'trades');
  const [sent, received] = await Promise.all([
    getDocs(query(tradesRef, where('from', '==', normalized))),
    getDocs(query(tradesRef, where('to', '==', normalized))),
  ]);
  const seen = new Set<string>();
  let offered = 0;
  let got = 0;
  let completed = 0;
  let accepted = 0;
  sent.forEach((snap) => {
    if (seen.has(snap.id)) return;
    seen.add(snap.id);
    offered += 1;
    if (snap.data().status === 'accepted') completed += 1;
  });
  received.forEach((snap) => {
    if (seen.has(snap.id)) return;
    seen.add(snap.id);
    got += 1;
    if (snap.data().status === 'accepted') {
      completed += 1;
      accepted += 1;
    }
  });
  return { address: normalized, offered, received: got, completed, accepted };
}

// Trade expiration utilities
export async function cancelExpiredTrades(): Promise<{ cancelled: number; errors: string[] }> {
  try {
    const tradesRef = collection(db, 'trades');
    const q = query(
      tradesRef,
      where('status', '==', 'pending'),
      where('expiresAt', '<=', new Date())
    );
    
    const querySnapshot = await getDocs(q);
    const batch = [];
    const errors: string[] = [];
    
    querySnapshot.forEach((doc) => {
      batch.push(
        updateTradeStatus(doc.id, 'expired', { 
          cancelReason: 'expired',
          cancelledAt: new Date()
        }).catch(error => {
          console.error(`Failed to cancel trade ${doc.id}:`, error);
          errors.push(`Trade ${doc.id}: ${error.message}`);
        })
      );
    });
    
    await Promise.all(batch);
    console.log('✅ Expired trades cancelled:', batch.length);
    return { cancelled: batch.length, errors };
  } catch (error) {
    console.error('Error cancelling expired trades:', error);
    throw error;
  }
}

function expiresAtDate(expiresAt: any): Date | null {
  if (!expiresAt) return null;
  if (expiresAt instanceof Date) return Number.isNaN(expiresAt.getTime()) ? null : expiresAt;
  if (typeof expiresAt.toDate === 'function') {
    const dated = expiresAt.toDate();
    return dated instanceof Date && !Number.isNaN(dated.getTime()) ? dated : null;
  }
  const seconds = expiresAt.seconds ?? expiresAt._seconds;
  if (typeof seconds === 'number') return new Date(seconds * 1000);
  if (typeof expiresAt === 'number') {
    return new Date(expiresAt < 1e12 ? expiresAt * 1000 : expiresAt);
  }
  const parsed = new Date(expiresAt);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function expiresAtMs(expiresAt: any): number | null {
  const expiration = expiresAtDate(expiresAt);
  return expiration ? expiration.getTime() : null;
}

export function isTradeExpired(expiresAt: any): boolean {
  const expiration = expiresAtDate(expiresAt);
  if (!expiration) return false;
  return expiration.getTime() <= Date.now();
}

export function getTimeUntilExpiration(expiresAt: any): string {
  const expiration = expiresAtDate(expiresAt);
  if (!expiration) return '';

  const diff = expiration.getTime() - Date.now();
  if (diff <= 0) return 'Expired';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) return `${hours}:${mm}:${ss}`;
  return `${minutes}:${ss}`;
}

 

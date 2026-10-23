'use client';

import React, { useState, useEffect, ComponentType, useMemo, useRef } from 'react';
import SafeImage from './SafeImage';
import SortDropdown from './SortDropdown';
import { Collection, NFT } from '../../types/nft';
import { isVerifiedNFT } from '../config/verifiedNFTs';
import {
  INVENTORY_CHANGED_EVENT,
  enrichHoldingsMeta,
  loadWalletInventory,
  peekOptimisticInventory,
  VerifiedNFTHolding,
  walletNeedsFastRefresh,
} from '../../services/verifiedNFTChecker';
import { useIsMounted } from '../hooks/useIsMounted';
import { useOpenSeaInventoryLive } from '../hooks/useOpenSeaInventoryLive';
import { parseEther } from 'viem';
import { useBalance, usePublicClient, useWalletClient } from 'wagmi';
import type { default as TradePanelType } from './TradePanel';
import { useRouter, useSearchParams } from 'next/navigation';
import { proposeTrade, getTrade, updateTradeStatus, type NFTItem } from '../../services/trade';
import { createTrade, declineTrade } from '../../services/blockchain';
import { createEscrowTrade, cancelEscrowTrade } from '../../services/escrow';
import { getEscrowAddress, loadEscrowAddress, isEscrowTrade, rememberEscrowAddress, MONAD_ESCROW_V1_ADDRESS } from '@/lib/escrow';
import { getTradeContractAddress, rememberTradeContract, MONAD_STAY_IN_WALLET_ADDRESS } from '@/lib/contracts';
import {
  blockedCollectionNames,
  classifyOfferItems,
  probeSelectedCollections,
  selectionFingerprint,
  unknownCollectionNames,
  type CollectionSendCheck,
} from '@/lib/transferPolicy';
import { DEFAULT_OFFER_DURATION, MAX_IN_WALLET_OFFER_DURATION, offerDurationLabel } from '@/lib/offerExpiry';
import { isEnsName } from '@/lib/ens';
import { isERC1155NFT } from '../config/verifiedNFTs';
import { toast } from 'react-hot-toast';
import { friendlyTradeError } from '@/lib/tradeErrors';
import { formatProtocolFee, readProtocolFee } from '@/lib/protocolFee';
import { useAppNetwork } from '../context/NetworkPrefContext';
import { freeTradePass } from '@/lib/freeTrade';
import { hasChogAmount, readChogBalance } from '@/lib/chog';
import { chainForNetwork } from '@/lib/networkPref';
import MyTrades from './MyTrades';
import TradeBoard from './tradeit/TradeBoard';
import ConfirmTradeSides from './ConfirmTradeSides';

interface TradeInterfaceProps {
  userAddress: string;
  TradePanelComponent: ComponentType<React.ComponentProps<typeof TradePanelType>>;
}

interface NFTWithCount extends NFT {
  ownedCount: number;
  selectedCount: number;
  isCounterparty?: boolean;
  collectionName?: string;
}

// Maximum NFT limit per side of trade
const MAX_NFTS_PER_SIDE = 8;

function itemToSelected(item: NFTItem, isCounterparty: boolean): NFTWithCount {
  const amount = Number(item.amount) || 1;
  const standard =
    item.standard === 'ERC1155' || item.standard === '1' || Number(item.standard) === 1
      ? 'ERC1155'
      : 'ERC721';
  return {
    tokenId: String(item.tokenId),
    name: item.name || `#${item.tokenId}`,
    image: item.image || '/placeholder.svg',
    collectionId: item.contract,
    contractAddress: item.contract,
    selectedCount: amount,
    ownedCount: amount,
    collectionName: item.collectionName,
    isCounterparty,
    standard,
  };
}

interface TradeState {
  userCollections: any[];
  userNFTsByCollection: Record<string, NFTWithCount[]>;
  counterpartyCollections: any[];
  counterpartyNFTsByCollection: Record<string, NFTWithCount[]>;
  userSelectedNFTs: NFTWithCount[];
  counterpartySelectedNFTs: NFTWithCount[];
  isLoadingUser: boolean;
  isLoadingCounterparty: boolean;
  error: string | null;
  quantitySelectNFT: NFTWithCount | null;
  userMonadAmount: string;
  counterpartyMonadAmount: string;
  userChogAmount: string;
  counterpartyChogAmount: string;
  userBalance: string;
  counterpartyBalance: string;
  userChogBalance: string;
  counterpartyChogBalance: string;
}

// Format balance to 2 decimal places
const formatBalance = (balance: string) => {
  const num = parseFloat(balance);
  return num.toFixed(2);
};

// Address validation utilities
const isValidEvmAddress = (address: string): boolean => {
  // EVM addresses are 42 characters long, start with 0x, and contain only hex characters
  return /^0x[a-fA-F0-9]{40}$/.test(address);
};

function sameWallet(a?: string, b?: string) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}


// Trade Header Component - Steam style with address validation
const TradeHeader = ({ 
  counterpartyAddress, 
  onCounterpartyAddressChange, 
  isLoadingCounterparty 
}: {
  counterpartyAddress: string;
  onCounterpartyAddressChange: (address: string) => void;
  isLoadingCounterparty: boolean;
}) => {
  const isValidAddress = isValidEvmAddress(counterpartyAddress);
  const hasInvalidAddress = counterpartyAddress.length > 10 && !isValidAddress;

  return (
    <div className="transition-colors duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-0">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-green-500 rounded-full"></div>
            <span className="text-gray-900 dark:text-white font-medium text-sm sm:text-base">This Trade:</span>
          </div>
          <span className="text-gray-600 dark:text-gray-300 text-sm sm:text-base">You are trading with</span>
          <div className="relative flex-1 sm:flex-none">
            <input
              type="text"
              value={counterpartyAddress}
              onChange={(e) => onCounterpartyAddressChange(e.target.value)}
              placeholder="Enter EVM address (0x...)"
              className={`w-full sm:min-w-[300px] bg-white/20 dark:bg-gray-800/20 backdrop-blur-md border rounded-xl px-3 py-1.5 text-gray-900 dark:text-gray-300 text-sm focus:outline-none focus:ring-2 transition-all duration-300 shadow-lg placeholder-gray-600 dark:placeholder-gray-300 ${
                hasInvalidAddress 
                  ? 'border-red-500/50 focus:ring-red-500/50 focus:border-red-500/70' 
                  : isValidAddress
                  ? 'border-green-500/50 focus:ring-green-500/50 focus:border-green-500/70'
                  : 'border-white/30 dark:border-gray-600/30 focus:ring-blue-500/50 dark:focus:ring-blue-400/50 focus:border-transparent'
              }`}
            />
            {isLoadingCounterparty && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2">
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
            )}
          </div>
        </div>

      </div>
      
      {/* Address validation notice */}
      {hasInvalidAddress && (
        <div className="mt-3 p-3 bg-red-900/30 border border-red-500/50 rounded-lg">
          <div className="flex items-start gap-2">
            <div className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5">
              ⚠️
            </div>
            <div className="flex-1">
              <p className="text-red-300 font-medium text-sm mb-1">
                Invalid Address Format
              </p>
              <p className="text-red-200 text-xs mb-2">
                Use a Robinhood Chain wallet address starting with 0x.
              </p>
              <p className="text-gray-300 text-xs">
                <strong>Required:</strong> EVM-compatible address starting with <code className="bg-gray-800 px-1 rounded">0x</code> (42 characters total)
              </p>
              <p className="text-gray-400 text-xs mt-1">
                <strong>Example:</strong> <code className="bg-gray-800 px-1 rounded text-green-400">0x742d35Cc6634C0532925a3b8D4e4F7F6e7546c65</code>
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default function TradeInterface({ userAddress, TradePanelComponent }: TradeInterfaceProps) {
  const network = useAppNetwork();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [protocolFeeWei, setProtocolFeeWei] = useState(0n);
  const isMounted = useIsMounted();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [counterpartyAddress, setCounterpartyAddress] = useState('');
  const [counterpartyInput, setCounterpartyInput] = useState('');
  const [ensLookup, setEnsLookup] = useState<{ status: 'idle' | 'loading' | 'ok' | 'missing'; name: string }>({
    status: 'idle',
    name: '',
  });
  const [counterFromId, setCounterFromId] = useState('');
  const counterOriginalFrom = useRef('');
  const [tradeMessage, setTradeMessage] = useState('');
  const [isCreatingTrade, setIsCreatingTrade] = useState(false);
  const [isProposing, setIsProposing] = useState(false);
  const proposingLock = useRef(false);
  const selectionEpoch = useRef(0);
  const [confirmOffer, setConfirmOffer] = useState(false);
  const [offerWait, setOfferWait] = useState<'wallet' | 'chain' | 'link' | null>(null);
  const [tradeMode, setTradeMode] = useState<'stay-in-wallet' | 'escrow'>('stay-in-wallet');
  const [escrowReady, setEscrowReady] = useState(false);
  const [sendChecks, setSendChecks] = useState<CollectionSendCheck[]>([]);
  const [checkingSends, setCheckingSends] = useState(false);
  const [offerDuration, setOfferDuration] = useState(DEFAULT_OFFER_DURATION);
  useEffect(() => {
    if (tradeMode !== 'escrow' && offerDuration > MAX_IN_WALLET_OFFER_DURATION) {
      setOfferDuration(MAX_IN_WALLET_OFFER_DURATION);
    }
  }, [tradeMode, offerDuration]);
  const [shareModalUrl, setShareModalUrl] = useState<string | null>(null);
  const [shareWasCounter, setShareWasCounter] = useState(false);
  const [tempQuantity, setTempQuantity] = useState<number | string>(1);
  
  // UI tabs & helpers
  const [activeTab, setActiveTab] = useState<'your' | 'their'>('your');
  const [activeMonadTab, setActiveMonadTab] = useState<'your' | 'their'>('your');
  const [showLimitInfo, setShowLimitInfo] = useState(false);

  // ---------- CORE STATE ----------
  // Must be declared before any hooks that reference `state`
  const [state, setState] = useState<TradeState>({
    userCollections: [],
    userNFTsByCollection: {},
    counterpartyCollections: [],
    counterpartyNFTsByCollection: {},
    userSelectedNFTs: [],
    counterpartySelectedNFTs: [],
    isLoadingUser: false,
    isLoadingCounterparty: false,
    error: null,
    quantitySelectNFT: null,
    userMonadAmount: '',
    counterpartyMonadAmount: '',
    userChogAmount: '',
    counterpartyChogAmount: '',
    userBalance: '0',
    counterpartyBalance: '0',
    userChogBalance: '0',
    counterpartyChogBalance: '0',
  });

  // Local UI state for filters in mobile lists
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'floor-asc' | 'floor-desc'>('floor-asc');


  // Handle clearing all selections with proper state reset
  const handleClearAll = () => {
    console.log('🧹 Clearing all selections and states...');
    setState(prev => ({
      ...prev,
      userSelectedNFTs: [],
      counterpartySelectedNFTs: [],
      userMonadAmount: '',
      counterpartyMonadAmount: '',
      userChogAmount: '',
      counterpartyChogAmount: '',
      error: null
    }));
    setTradeMessage('');
    setConfirmOffer(false);
  };

  const counterId = searchParams.get('counter');
  useEffect(() => {
    if (!counterId || !userAddress) return;
    let cancelled = false;
    getTrade(counterId)
      .then((trade) => {
        if (cancelled || !trade) return;
        if (trade.to?.toLowerCase() !== userAddress.toLowerCase()) {
          toast.error('Connect the wallet this offer was sent to.');
          return;
        }
        if ((trade.status || 'pending') !== 'pending') {
          toast.error('That offer is no longer open.');
          return;
        }
        setCounterFromId(trade.id || counterId);
        counterOriginalFrom.current = (trade.from || '').toLowerCase();
        setCounterpartyAddress(trade.from);
        setCounterpartyInput(trade.from);
        setEnsLookup({ status: 'idle', name: '' });
        if (isEscrowTrade(trade)) setTradeMode('escrow');
        setState((prev) => ({
          ...prev,
          userSelectedNFTs: (trade.requested || []).map((item) => itemToSelected(item, false)),
          counterpartySelectedNFTs: (trade.offer || []).map((item) => itemToSelected(item, true)),
          userMonadAmount:
            trade.requestedMonad && Number(trade.requestedMonad) > 0 ? String(trade.requestedMonad) : '',
          counterpartyMonadAmount:
            trade.offeredMonad && Number(trade.offeredMonad) > 0 ? String(trade.offeredMonad) : '',
          userChogAmount:
            trade.requestedChog && Number(trade.requestedChog) > 0 ? String(trade.requestedChog) : '',
          counterpartyChogAmount:
            trade.offeredChog && Number(trade.offeredChog) > 0 ? String(trade.offeredChog) : '',
        }));
      })
      .catch(() => {
        if (!cancelled) toast.error('Could not load that offer.');
      });
    return () => {
      cancelled = true;
    };
  }, [counterId, userAddress]);

  useEffect(() => {
    if (!counterFromId || !counterOriginalFrom.current || !counterpartyAddress) return;
    if (counterpartyAddress.toLowerCase() !== counterOriginalFrom.current) {
      setCounterFromId('');
    }
  }, [counterpartyAddress, counterFromId]);

  useEffect(() => {
    if (!offerWait) return;
    const onLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [offerWait]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (network === 'monad') {
        rememberTradeContract(MONAD_STAY_IN_WALLET_ADDRESS, 143);
        rememberEscrowAddress(MONAD_ESCROW_V1_ADDRESS, 143);
      }
      loadEscrowAddress()
        .then((address) => {
          if (!cancelled) setEscrowReady(Boolean(address));
        })
        .catch(() => {
          if (!cancelled) setEscrowReady(Boolean(getEscrowAddress()));
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [network]);

  useEffect(() => {
    const items = [
      ...state.userSelectedNFTs.map((nft) => ({ ...nft, owner: userAddress, recipient: counterpartyAddress })),
      ...state.counterpartySelectedNFTs.map((nft) => ({ ...nft, owner: counterpartyAddress, recipient: userAddress })),
    ];
    if (items.length === 0) {
      setSendChecks([]);
      setCheckingSends(false);
      return;
    }
    let cancelled = false;
    setCheckingSends(true);
    probeSelectedCollections(items)
      .then((results) => {
        if (!cancelled) setSendChecks(results);
      })
      .catch(() => {
        if (!cancelled) {
          setSendChecks(
            items.map((item) => ({
              contractAddress: item.contractAddress || '',
              tokenId: String(item.tokenId || ''),
              name: item.collectionName || item.name || 'This NFT',
              operatorSend: 'unknown' as const,
            }))
          );
        }
      })
      .finally(() => {
        if (!cancelled) setCheckingSends(false);
      });
    return () => {
      cancelled = true;
    };
  }, [state.userSelectedNFTs, state.counterpartySelectedNFTs, userAddress, counterpartyAddress]);

  useEffect(() => {
    selectionEpoch.current += 1;
  }, [state.userSelectedNFTs, state.counterpartySelectedNFTs, counterpartyAddress]);

  const blockedSends = useMemo(() => blockedCollectionNames(sendChecks), [sendChecks]);
  const unknownSends = useMemo(() => unknownCollectionNames(sendChecks), [sendChecks]);
  const mustEscrow = blockedSends.length > 0;
  const inWalletBlocked = mustEscrow || unknownSends.length > 0;

  useEffect(() => {
    if (inWalletBlocked && tradeMode !== 'escrow') {
      setTradeMode('escrow');
    }
  }, [inWalletBlocked, tradeMode]);

  useOpenSeaInventoryLive([userAddress, counterpartyAddress]);

  const [userVerifiedHoldings, setUserVerifiedHoldings] = useState<VerifiedNFTHolding[]>([]);
  const [isLoadingVerifiedNFTs, setIsLoadingVerifiedNFTs] = useState(false);
  const [counterpartyVerifiedHoldings, setCounterpartyVerifiedHoldings] = useState<VerifiedNFTHolding[]>([]);
  const [isLoadingCounterpartyVerifiedNFTs, setIsLoadingCounterpartyVerifiedNFTs] = useState(false);

  // Direct verified NFT checker - bypasses collections API
  useEffect(() => {
    if (!userAddress || !isMounted) return;

    let cancelled = false;
    const load = (silent = false, forceRefresh = false) => {
      const wallet = userAddress.toLowerCase();
      const optimistic = peekOptimisticInventory(wallet);
      const hasOptimistic = Boolean(optimistic.length || walletNeedsFastRefresh(wallet));
      if (hasOptimistic) {
        setUserVerifiedHoldings(optimistic);
      }
      if (!silent && !hasOptimistic) setIsLoadingVerifiedNFTs(true);
      loadWalletInventory(wallet, { forceRefresh: forceRefresh || walletNeedsFastRefresh(wallet) })
        .then(async (inventory) => {
          if (cancelled || inventory.wallet !== wallet) return;
          setUserVerifiedHoldings(inventory.holdings);
          const ranked = await enrichHoldingsMeta(inventory.holdings);
          if (cancelled || inventory.wallet !== wallet) return;
          setUserVerifiedHoldings(ranked);
        })
        .catch((error) => {
          console.error('Error checking verified NFTs:', error);
        })
        .finally(() => {
          if (!cancelled && !silent) setIsLoadingVerifiedNFTs(false);
        });
    };

    load(false, true);
    const onFresh = (event: Event) => {
      const wallet = String((event as CustomEvent)?.detail?.wallet || '');
      if (wallet && wallet !== userAddress.toLowerCase()) return;
      load(true, true);
    };
    const onFocus = () => load(true, true);
    window.addEventListener(INVENTORY_CHANGED_EVENT, onFresh);
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      load(true, true);
    }, 8_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener(INVENTORY_CHANGED_EVENT, onFresh);
      window.removeEventListener('focus', onFocus);
    };
  }, [userAddress, isMounted]);

  // Direct verified NFT checker for counterparty
  useEffect(() => {
    if (!isMounted) return;
    const wallet = counterpartyAddress.trim();
    const valid = wallet.length >= 35 && wallet.startsWith('0x');
    if (!valid) {
      setCounterpartyVerifiedHoldings([]);
      setIsLoadingCounterpartyVerifiedNFTs(false);
      return;
    }

    let cancelled = false;
    const requested = wallet.toLowerCase();
    const cached = peekOptimisticInventory(requested);
    if (cached.length) {
      setCounterpartyVerifiedHoldings(cached);
      setIsLoadingCounterpartyVerifiedNFTs(false);
    } else {
      setIsLoadingCounterpartyVerifiedNFTs(true);
    }
    const loadTheirs = (silent = false, forceRefresh = false) => {
      const optimistic = peekOptimisticInventory(requested);
      const hasOptimistic = Boolean(optimistic.length);
      if (hasOptimistic) {
        setCounterpartyVerifiedHoldings(optimistic);
      } else if (!silent) {
        setIsLoadingCounterpartyVerifiedNFTs(true);
      }
      loadWalletInventory(requested, { forceRefresh: forceRefresh || walletNeedsFastRefresh(requested) })
        .then(async (inventory) => {
          if (cancelled || inventory.wallet !== requested) return;
          setCounterpartyVerifiedHoldings(inventory.holdings);
          const ranked = await enrichHoldingsMeta(inventory.holdings);
          if (cancelled || inventory.wallet !== requested) return;
          setCounterpartyVerifiedHoldings(ranked);
        })
        .catch((error) => {
          console.error('Error checking counterparty verified NFTs:', error);
        })
        .finally(() => {
          if (!cancelled && !silent) setIsLoadingCounterpartyVerifiedNFTs(false);
        });
    };
    const start = window.setTimeout(() => loadTheirs(false, true), 150);
    const onFresh = (event: Event) => {
      const wallet = String((event as CustomEvent)?.detail?.wallet || '');
      if (wallet && wallet !== requested) return;
      loadTheirs(true, true);
    };
    window.addEventListener(INVENTORY_CHANGED_EVENT, onFresh);
    const timer = window.setInterval(() => loadTheirs(true, true), 20_000);
    return () => {
      cancelled = true;
      window.clearTimeout(start);
      window.clearInterval(timer);
      window.removeEventListener(INVENTORY_CHANGED_EVENT, onFresh);
    };
  }, [counterpartyAddress, isMounted]);

  useEffect(() => {
    const value = counterpartyInput.trim();
    if (!isEnsName(value)) {
      setEnsLookup({ status: 'idle', name: '' });
      return;
    }
    const name = value.toLowerCase();
    let cancelled = false;
    setEnsLookup({ status: 'loading', name });
    const timer = window.setTimeout(() => {
      fetch(`/api/ens?name=${encodeURIComponent(name)}`)
        .then((res) => res.json())
        .then((data: { address?: string }) => {
          if (cancelled) return;
          const address = String(data.address || '');
          if (!isValidEvmAddress(address)) {
            setEnsLookup({ status: 'missing', name });
            setCounterpartyAddress('');
            return;
          }
          setEnsLookup({ status: 'ok', name });
          setCounterpartyAddress(address);
        })
        .catch(() => {
          if (!cancelled) {
            setEnsLookup({ status: 'missing', name });
            setCounterpartyAddress('');
          }
        });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [counterpartyInput]);

  // Direct verified NFT checker - bypasses collections API
  const { data: userBalanceData } = useBalance({
    address: userAddress as unknown as `0x${string}`,
    chainId: chainForNetwork(network).id,
  });

  // Get counterparty balance  
  const { data: counterpartyBalanceData } = useBalance({
    address: isValidEvmAddress(counterpartyAddress) ? (counterpartyAddress as unknown as `0x${string}`) : undefined,
    chainId: chainForNetwork(network).id,
  });

  // Update balances
  useEffect(() => {
    if (userBalanceData?.formatted) {
      setState(prev => ({ ...prev, userBalance: userBalanceData.formatted }));
    }
  }, [userBalanceData]);

  useEffect(() => {
    if (network !== 'monad') {
      setState((prev) => ({ ...prev, userChogBalance: '0', counterpartyChogBalance: '0' }));
      return;
    }
    let cancelled = false;
    const load = async () => {
      const [yours, theirs] = await Promise.all([
        readChogBalance(userAddress),
        isValidEvmAddress(counterpartyAddress) ? readChogBalance(counterpartyAddress) : Promise.resolve('0'),
      ]);
      if (!cancelled) {
        setState((prev) => ({ ...prev, userChogBalance: yours, counterpartyChogBalance: theirs }));
      }
    };
    load().catch(() => undefined);
    const timer = window.setInterval(() => load().catch(() => undefined), 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [network, userAddress, counterpartyAddress]);

  useEffect(() => {
    let cancelled = false;
    readProtocolFee(publicClient, tradeMode, userAddress).then((fee) => {
      if (!cancelled) setProtocolFeeWei(fee);
    });
    return () => {
      cancelled = true;
    };
  }, [publicClient, tradeMode, escrowReady, userAddress]);

  useEffect(() => {
    if (counterpartyBalanceData?.formatted) {
      setState(prev => ({ ...prev, counterpartyBalance: counterpartyBalanceData.formatted }));
    }
  }, [counterpartyBalanceData]);

  const handleUserSelect = (nft: NFTWithCount) => {
    const existingIndex = state.userSelectedNFTs.findIndex(
      selected => selected.tokenId === nft.tokenId && selected.contractAddress === nft.contractAddress
    );

    if (existingIndex >= 0) {
      // Remove NFT if already selected
      setState(prev => ({
        ...prev,
        userSelectedNFTs: prev.userSelectedNFTs.filter((_, index) => index !== existingIndex)
      }));
      return;
    }

    // Check if adding this NFT would exceed the 8-item limit
    const currentTotalCount = state.userSelectedNFTs.reduce((total, selectedNft) => total + selectedNft.selectedCount, 0);
    if (currentTotalCount >= MAX_NFTS_PER_SIDE) {
      setState(prev => ({ ...prev, error: `Maximum ${MAX_NFTS_PER_SIDE} items can be offered per trade. Remove some items first.` }));
      return;
    }

    // For ERC1155 NFTs with multiple copies, show quantity selector
    if (nft.standard === 'ERC1155' && nft.ownedCount > 1) {
      const existingSelected = state.userSelectedNFTs.find(selected => selected.tokenId === nft.tokenId && selected.contractAddress === nft.contractAddress);
      setTempQuantity(existingSelected?.selectedCount || 1);
      setState(prev => ({
        ...prev,
        quantitySelectNFT: nft
      }));
      return;
    }

    // Add NFT if not selected
    setState(prev => ({
      ...prev,
      userSelectedNFTs: [...prev.userSelectedNFTs, { ...nft, selectedCount: 1 }]
    }));
  };

  const handleCounterpartySelect = (nft: NFTWithCount) => {
    if (sameWallet(counterpartyAddress, userAddress)) return;
    const existingIndex = state.counterpartySelectedNFTs.findIndex(
      selected => selected.tokenId === nft.tokenId && selected.contractAddress === nft.contractAddress
    );

    if (existingIndex >= 0) {
      // Remove NFT if already selected
      setState(prev => ({
        ...prev,
        counterpartySelectedNFTs: prev.counterpartySelectedNFTs.filter((_, index) => index !== existingIndex)
      }));
      return;
    }

    // Check if adding this NFT would exceed the 8-item limit
    const currentTotalCount = state.counterpartySelectedNFTs.reduce((total, selectedNft) => total + selectedNft.selectedCount, 0);
    if (currentTotalCount >= MAX_NFTS_PER_SIDE) {
      setState(prev => ({ ...prev, error: `Maximum ${MAX_NFTS_PER_SIDE} items can be requested per trade. Remove some items first.` }));
      return;
    }

    // For ERC1155 NFTs with multiple copies, show quantity selector
    if (nft.standard === 'ERC1155' && nft.ownedCount > 1) {
      const existingSelected = state.counterpartySelectedNFTs.find(selected => selected.tokenId === nft.tokenId && selected.contractAddress === nft.contractAddress);
      setTempQuantity(existingSelected?.selectedCount || 1);
      setState(prev => ({
        ...prev,
        quantitySelectNFT: { ...nft, isCounterparty: true }
      }));
      return;
    }

    // Add NFT if not selected
    setState(prev => ({
      ...prev,
      counterpartySelectedNFTs: [...prev.counterpartySelectedNFTs, { ...nft, selectedCount: 1 }]
    }));
  };

  const handleQuantitySelect = (quantity: number) => {
    if (!state.quantitySelectNFT) return;

    const nft = state.quantitySelectNFT;
    const isCounterparty = nft.isCounterparty;

    if (isCounterparty) {
      const existingIndex = state.counterpartySelectedNFTs.findIndex(
        selected => selected.tokenId === nft.tokenId && selected.contractAddress === nft.contractAddress
      );

      if (quantity === 0) {
        // Remove NFT if quantity is 0
        if (existingIndex >= 0) {
          setState(prev => ({
            ...prev,
            counterpartySelectedNFTs: prev.counterpartySelectedNFTs.filter((_, index) => index !== existingIndex),
            quantitySelectNFT: null
          }));
        }
      } else {
        // Check if the new quantity would exceed the limit
        const currentTotalCount = state.counterpartySelectedNFTs.reduce((total, selectedNft, index) => {
          if (index === existingIndex) {
            return total; // Don't count the current item we're updating
          }
          return total + selectedNft.selectedCount;
        }, 0);
        
        if (currentTotalCount + quantity > MAX_NFTS_PER_SIDE) {
          setState(prev => ({ ...prev, error: `Maximum ${MAX_NFTS_PER_SIDE} items can be requested per trade. Current selection would exceed limit.` }));
          return;
        }

        if (existingIndex >= 0) {
          // Update existing selection
          setState(prev => ({
            ...prev,
            counterpartySelectedNFTs: prev.counterpartySelectedNFTs.map((selected, index) =>
              index === existingIndex ? { ...selected, selectedCount: quantity } : selected
            ),
            quantitySelectNFT: null
          }));
        } else {
          // Add new selection
          setState(prev => ({
            ...prev,
            counterpartySelectedNFTs: [...prev.counterpartySelectedNFTs, { ...nft, selectedCount: quantity }],
            quantitySelectNFT: null
          }));
        }
      }
    } else {
      const existingIndex = state.userSelectedNFTs.findIndex(
        selected => selected.tokenId === nft.tokenId && selected.contractAddress === nft.contractAddress
      );

      if (quantity === 0) {
        // Remove NFT if quantity is 0
        if (existingIndex >= 0) {
          setState(prev => ({
            ...prev,
            userSelectedNFTs: prev.userSelectedNFTs.filter((_, index) => index !== existingIndex),
            quantitySelectNFT: null
          }));
        }
      } else {
        // Check if the new quantity would exceed the limit
        const currentTotalCount = state.userSelectedNFTs.reduce((total, selectedNft, index) => {
          if (index === existingIndex) {
            return total; // Don't count the current item we're updating
          }
          return total + selectedNft.selectedCount;
        }, 0);
        
        if (currentTotalCount + quantity > MAX_NFTS_PER_SIDE) {
          setState(prev => ({ ...prev, error: `Maximum ${MAX_NFTS_PER_SIDE} items can be offered per trade. Current selection would exceed limit.` }));
          return;
        }

        if (existingIndex >= 0) {
          // Update existing selection
          setState(prev => ({
            ...prev,
            userSelectedNFTs: prev.userSelectedNFTs.map((selected, index) =>
              index === existingIndex ? { ...selected, selectedCount: quantity } : selected
            ),
            quantitySelectNFT: null
          }));
        } else {
          // Add new selection
          setState(prev => ({
            ...prev,
            userSelectedNFTs: [...prev.userSelectedNFTs, { ...nft, selectedCount: quantity }],
            quantitySelectNFT: null
          }));
        }
      }
    }
  };

  const closeQuantityModal = () => {
    setState(prev => ({
      ...prev,
      quantitySelectNFT: null
    }));
  };

  const handleProposeTrade = async () => {
    if (proposingLock.current) return;
    proposingLock.current = true;
    const epoch = selectionEpoch.current;

    if (!userAddress || !counterpartyAddress || !isValidEvmAddress(counterpartyAddress)) {
      proposingLock.current = false;
      setState(prev => ({ ...prev, error: 'Please enter a valid counterparty address' }));
      return;
    }

    if (sameWallet(counterpartyAddress, userAddress)) {
      proposingLock.current = false;
      setState((prev) => ({
        ...prev,
        error: 'You can’t trade with your own wallet. Paste a different address.',
      }));
      toast.error('You can’t trade with your own wallet.');
      return;
    }

    if (checkingSends) {
      proposingLock.current = false;
      toast.error('Still checking if this collection can go in-wallet. Wait a second.');
      return;
    }

    const selectedItems = [
      ...state.userSelectedNFTs.map((nft) => ({ ...nft, owner: userAddress, recipient: counterpartyAddress })),
      ...state.counterpartySelectedNFTs.map((nft) => ({ ...nft, owner: counterpartyAddress, recipient: userAddress })),
    ];
    let live;
    try {
      live = await classifyOfferItems(selectedItems, undefined, { fresh: true });
    } catch {
      proposingLock.current = false;
      toast.error('Could not re-check these NFTs. Wait a second, or send as Escrow.');
      return;
    }
    setSendChecks(live.checks);
    const currentItems = [
      ...state.userSelectedNFTs.map((nft) => ({ ...nft, owner: userAddress, recipient: counterpartyAddress })),
      ...state.counterpartySelectedNFTs.map((nft) => ({ ...nft, owner: counterpartyAddress, recipient: userAddress })),
    ];
    if (epoch !== selectionEpoch.current || live.fingerprint !== selectionFingerprint(currentItems)) {
      proposingLock.current = false;
      toast.error('Selection changed. Check the offer again.');
      return;
    }
    if (live.blocked.length && tradeMode !== 'escrow') {
      proposingLock.current = false;
      setTradeMode('escrow');
      setState((prev) => ({
        ...prev,
        error: `${live.blocked.join(', ')} ${live.blocked.length === 1 ? 'needs' : 'need'} Escrow. In-wallet offers are off for this collection.`,
      }));
      return;
    }
    if (tradeMode !== 'escrow' && !live.canInWallet) {
      proposingLock.current = false;
      setTradeMode(live.blocked.length ? 'escrow' : tradeMode);
      toast.error(
        live.unknown.length
          ? `Could not confirm ${live.unknown.join(', ')} for an in-wallet send. Wait, or send as Escrow.`
          : 'In-wallet send is not confirmed for this selection.'
      );
      return;
    }

    setIsProposing(true);
    setConfirmOffer(false);
    setOfferWait('wallet');

    if (counterFromId && walletClient) {
      try {
        const original = await getTrade(counterFromId);
        if (!original?.blockchainTradeId || original.chainStatusUnknown) {
          throw new Error('Cannot confirm the old offer on-chain. Try again, then send the counter.');
        }
        const originalStatus = String(original.status || 'pending');
        if (originalStatus === 'pending' || originalStatus === 'incomplete') {
          toast.loading('Closing the old offer first…', { id: 'make-offer', duration: 0 });
          if (isEscrowTrade(original)) {
            await cancelEscrowTrade(
              String(original.blockchainTradeId),
              walletClient,
              (message) => toast.loading(message, { id: 'make-offer', duration: 0 }),
              original.tradeContract
            );
          } else {
            await declineTrade(original.blockchainTradeId, walletClient, original.tradeContract);
          }
          await updateTradeStatus(original.id || counterFromId, 'declined', {
            declinedBy: userAddress,
          }).catch(() => undefined);
        }
      } catch (closeError: any) {
        console.error('Could not close the original offer:', closeError);
        toast.error(
          closeError?.message || 'The old offer is still open. Close it, then send the counter.',
          { id: 'make-offer' }
        );
        proposingLock.current = false;
        setIsProposing(false);
        setOfferWait(null);
        return;
      }
    }

    const offeredWei = parseEther(state.userMonadAmount || '0');
    const walletWei = userBalanceData?.value ?? 0n;
    const neededWei = offeredWei + protocolFeeWei;
    if (neededWei > walletWei) {
      const message = protocolFeeWei > 0n
        ? `Not enough ETH. You need ${formatProtocolFee(neededWei)} (includes ${formatProtocolFee(protocolFeeWei)} fee).`
        : 'Not enough ETH.';
      setState((prev) => ({ ...prev, error: message }));
      toast.error(message, { id: 'make-offer' });
      proposingLock.current = false;
      setIsProposing(false);
      setOfferWait(null);
      return;
    }

    try {
      toast.loading(
        tradeMode === 'escrow'
          ? 'Escrow: confirm the offer, then send your NFTs'
          : 'In wallet: approve, then confirm the offer',
        {
        id: 'make-offer',
        duration: 0,
      });
      const nftPayload = {
        userNFTs: state.userSelectedNFTs.map(nft => ({
          contractAddress: nft.contractAddress,
          tokenId: nft.tokenId,
          amount: nft.selectedCount.toString(),
          standard: nft.standard === 'ERC1155' ? 1 : 0
        })),
        counterpartyNFTs: state.counterpartySelectedNFTs.map(nft => ({
          contractAddress: nft.contractAddress,
          tokenId: nft.tokenId,
          amount: nft.selectedCount.toString(),
          standard: nft.standard === 'ERC1155' ? 1 : 0
        })),
        userMonadAmount: state.userMonadAmount || '0',
        counterpartyMonadAmount: state.counterpartyMonadAmount || '0',
        userChogAmount: network === 'monad' ? state.userChogAmount || '0' : '0',
        counterpartyChogAmount: network === 'monad' ? state.counterpartyChogAmount || '0' : '0',
      };
      const blockchainTradeId =
        tradeMode === 'escrow'
          ? await createEscrowTrade(
              { counterpartyAddress, ...nftPayload, durationSeconds: offerDuration },
              walletClient,
              (message) => {
                toast.loading(message, { id: 'make-offer', duration: 0 });
                if (/confirming on-chain/i.test(message)) setOfferWait('chain');
                if (/trade link/i.test(message)) setOfferWait('link');
              }
            )
          : await createTrade(
              {
                ...nftPayload,
                counterpartyAddress,
                message: tradeMessage,
                durationSeconds: offerDuration,
              },
              walletClient,
              (phase) => setOfferWait(phase)
            );

      console.log('✅ Blockchain trade created:', blockchainTradeId);

      // Step 2: Create Firebase record for shareable link (optional; chain is source of truth)
      console.log('Creating Firebase record...');
      setOfferWait('link');
      let result: string | null = null;
      try {
        result = await proposeTrade({
          from: userAddress,
          to: counterpartyAddress,
          offer: state.userSelectedNFTs.map(nft => ({
            contract: nft.contractAddress,
            tokenId: nft.tokenId,
            image: nft.image,
            name: nft.name,
            collectionName: nft.collectionName,
            amount: nft.selectedCount.toString(),
            standard: nft.standard
          })),
          requested: state.counterpartySelectedNFTs.map(nft => ({
            contract: nft.contractAddress,
            tokenId: nft.tokenId,
            image: nft.image,
            name: nft.name,
            collectionName: nft.collectionName,
            amount: nft.selectedCount.toString(),
            standard: nft.standard
          })),
          offeredMonad: state.userMonadAmount || '0',
          requestedMonad: state.counterpartyMonadAmount || '0',
          offeredChog: network === 'monad' ? state.userChogAmount || '0' : '0',
          requestedChog: network === 'monad' ? state.counterpartyChogAmount || '0' : '0',
          message: tradeMessage,
          blockchainTradeId: blockchainTradeId,
          network,
          expiresAt: new Date(Date.now() + offerDuration * 1000),
          tradeType: tradeMode === 'escrow' ? 'escrow-program' : 'stay-in-wallet',
          tradeContract:
            tradeMode === 'escrow'
              ? getEscrowAddress()
              : (await import('@/lib/contracts')).getTradeContractAddress(),
          counteredFrom: counterFromId || undefined,
        });
      } catch (firebaseError) {
        console.warn('Firebase record failed; trade is still on-chain:', firebaseError);
      }

      {
        const newTradeId = result || blockchainTradeId;
        const tradeUrl = `${window.location.origin}/trade/${newTradeId}`;

        if (counterFromId) {
          await updateTradeStatus(counterFromId, 'declined', {
            counteredWith: newTradeId,
            declinedBy: userAddress,
          }).catch(() => undefined);
        }

        toast.success(counterFromId ? 'Counter sent' : 'Offer sent', {
          id: 'make-offer',
          duration: 4000,
          position: 'top-center'
        });
        window.sessionStorage.setItem(
          'etaswap-just-sent',
          JSON.stringify({
            to: counterpartyAddress,
            at: Date.now(),
            id: newTradeId,
          })
        );
        setShareModalUrl(tradeUrl);
        setShareWasCounter(Boolean(counterFromId));
        setCounterFromId('');
        window.history.replaceState(null, '', '/trade');
        setState(prev => ({
          ...prev,
          userSelectedNFTs: [],
          counterpartySelectedNFTs: [],
          userMonadAmount: '',
          counterpartyMonadAmount: '',
          userChogAmount: '',
          counterpartyChogAmount: '',
        }));
        setTradeMessage('');
      }
    } catch (error: any) {
      console.error('❌ Error proposing trade:', error);
      const leftoverId = error?.escrowTradeId?.toString?.();
      if (leftoverId && tradeMode === 'escrow') {
        let savedId = leftoverId;
        try {
          savedId = await proposeTrade({
            from: userAddress,
            to: counterpartyAddress,
            offer: state.userSelectedNFTs.map((nft) => ({
              contract: nft.contractAddress,
              tokenId: nft.tokenId,
              image: nft.image,
              name: nft.name,
              collectionName: nft.collectionName,
              amount: nft.selectedCount.toString(),
              standard: nft.standard,
            })),
            requested: state.counterpartySelectedNFTs.map((nft) => ({
              contract: nft.contractAddress,
              tokenId: nft.tokenId,
              image: nft.image,
              name: nft.name,
              collectionName: nft.collectionName,
              amount: nft.selectedCount.toString(),
              standard: nft.standard,
            })),
            offeredMonad: state.userMonadAmount || '0',
            requestedMonad: state.counterpartyMonadAmount || '0',
            offeredChog: state.userChogAmount || '0',
            requestedChog: state.counterpartyChogAmount || '0',
            message: tradeMessage,
            blockchainTradeId: leftoverId,
            network,
            expiresAt: new Date(Date.now() + offerDuration * 1000),
            tradeType: 'escrow-program',
            tradeContract: getEscrowAddress(),
            status: 'incomplete',
          });
        } catch {
          /* leftover NFT is still in escrow */
        }
        toast.error('Offer did not go through. Claim the NFT that already went into escrow.', {
          id: 'make-offer',
          duration: 8000,
          position: 'top-center',
        });
        setState((prev) => ({
          ...prev,
          error: 'Offer did not go through. Claim your NFT from escrow.',
        }));
        setIsProposing(false);
        setOfferWait(null);
        router.push(`/trade/${savedId}`);
        return;
      }
      let errorMessage = friendlyTradeError(error);
      if (error?.message?.includes('User rejected') || error?.message?.includes('user rejected')) {
        errorMessage = 'Transaction was cancelled';
      } else if (error?.message?.includes('Cannot trade with yourself')) {
        errorMessage = 'Use a different wallet as the other side';
      }
      
      // Show error toast
      toast.error(errorMessage, {
        id: 'make-offer',
        duration: 4000,
        position: 'top-center'
      });
      
      setState(prev => ({
        ...prev,
        error: errorMessage
      }));
    } finally {
      proposingLock.current = false;
      setIsProposing(false);
      setOfferWait(null);
    }
  };

  const tradingWithSelf = sameWallet(counterpartyAddress, userAddress);

  useEffect(() => {
    if (!tradingWithSelf) return;
    setState((prev) => ({
      ...prev,
      userSelectedNFTs: [],
      counterpartySelectedNFTs: [],
      userMonadAmount: '',
      counterpartyMonadAmount: '',
      userChogAmount: '',
      counterpartyChogAmount: '',
      quantitySelectNFT: null,
    }));
  }, [tradingWithSelf]);

  const canMakeOffer = (
    counterpartyAddress &&
    isValidEvmAddress(counterpartyAddress) &&
    !tradingWithSelf &&
    (state.userSelectedNFTs.length > 0 ||
      parseFloat(state.userMonadAmount) > 0 ||
      hasChogAmount(state.userChogAmount) ||
      hasChogAmount(state.counterpartyChogAmount) ||
      parseFloat(state.counterpartyMonadAmount) > 0)
  );

  // Utility to remove an NFT selection directly (used by red × buttons)
  const removeSelectedNFT = (nft: NFTWithCount, isCounterparty: boolean) => {
    setState(prev => {
      const keyMatch = (selected: NFTWithCount) => selected.tokenId === nft.tokenId && selected.contractAddress === nft.contractAddress;
      const newState = { ...prev } as TradeState;
      if (isCounterparty) {
        newState.counterpartySelectedNFTs = prev.counterpartySelectedNFTs.filter(sel => !keyMatch(sel));
      } else {
        newState.userSelectedNFTs = prev.userSelectedNFTs.filter(sel => !keyMatch(sel));
      }
      // Close quantity modal if it was open for this NFT
      if (prev.quantitySelectNFT && keyMatch(prev.quantitySelectNFT)) {
        newState.quantitySelectNFT = null;
      }
      return newState;
    });
  };

  if (!isMounted) {
    return null;
  }

  return (
    <div className="bg-black text-[#f5f5f7]">
      <TradeBoard
        userAddress={userAddress}
        counterpartyAddress={counterpartyInput}
        onCounterpartyChange={(value) => {
          setCounterpartyInput(value);
          const trimmed = value.trim();
          if (isValidEvmAddress(trimmed)) {
            if (trimmed.toLowerCase() !== counterpartyAddress.toLowerCase()) {
              setState((prev) => ({ ...prev, counterpartySelectedNFTs: [] }));
            }
            setCounterpartyAddress(trimmed);
            setEnsLookup({ status: 'idle', name: '' });
            return;
          }
          if (!isEnsName(trimmed) && counterpartyAddress) {
            setCounterpartyAddress('');
            setState((prev) => ({ ...prev, counterpartySelectedNFTs: [] }));
            setEnsLookup({ status: 'idle', name: '' });
          }
        }}
        ensLookup={ensLookup}
        resolvedAddress={counterpartyAddress}
        userHoldings={userVerifiedHoldings}
        theirHoldings={counterpartyVerifiedHoldings}
        userLoading={isLoadingVerifiedNFTs}
        theirLoading={isLoadingCounterpartyVerifiedNFTs || state.isLoadingCounterparty}
        userSelected={state.userSelectedNFTs}
        theirSelected={state.counterpartySelectedNFTs}
        onPickUser={(nft) => handleUserSelect(nft as any)}
        onPickTheir={(nft) => handleCounterpartySelect(nft as any)}
        onRemoveUser={(item) => removeSelectedNFT(item as any, false)}
        onRemoveTheir={(item) => removeSelectedNFT(item as any, true)}
        userEth={state.userMonadAmount}
        theirEth={state.counterpartyMonadAmount}
        onUserEth={(value) => setState((prev) => ({ ...prev, userMonadAmount: value }))}
        onTheirEth={(value) => setState((prev) => ({ ...prev, counterpartyMonadAmount: value }))}
        userChog={state.userChogAmount}
        theirChog={state.counterpartyChogAmount}
        onUserChog={(value) => setState((prev) => ({ ...prev, userChogAmount: value }))}
        onTheirChog={(value) => setState((prev) => ({ ...prev, counterpartyChogAmount: value }))}
        userBalance={state.userBalance}
        theirBalance={state.counterpartyBalance}
        userChogBalance={state.userChogBalance}
        theirChogBalance={state.counterpartyChogBalance}
        protocolFee={protocolFeeWei > 0n ? formatProtocolFee(protocolFeeWei) : ''}
        feeWaived={
          network === 'monad'
            ? Boolean(freeTradePass(userVerifiedHoldings))
            : freeTradePass(userVerifiedHoldings) === 'eta'
        }
        canTrade={!!canMakeOffer}
        isTrading={isProposing}
        tradingWithSelf={tradingWithSelf}
        onTrade={() => {
          if (tradingWithSelf) {
            toast.error('You can’t trade with your own wallet.');
            return;
          }
          if (inWalletBlocked && tradeMode !== 'escrow') {
            setTradeMode('escrow');
            return;
          }
          setConfirmOffer(true);
        }}
        onClear={handleClearAll}
        tradeMode={tradeMode}
        onTradeModeChange={(mode) => {
          if (inWalletBlocked && mode !== 'escrow') return;
          setTradeMode(mode);
        }}
        escrowReady={escrowReady}
        checkingSends={checkingSends}
        blockedSends={[...blockedSends, ...unknownSends]}
        sendChecks={sendChecks}
        offerDuration={offerDuration}
        onOfferDurationChange={setOfferDuration}
        isCountering={Boolean(counterFromId)}
      />


        {/* Error Display */}
        {state.error && (
          <div
            role="alert"
            className="fixed bottom-5 right-4 z-50 w-[calc(100%-2rem)] max-w-[380px] rounded-[20px] border border-black/[0.06] bg-white/95 p-4 text-ink shadow-[0_8px_32px_rgba(0,0,0,0.10)] backdrop-blur-xl dark:border-white/10 dark:bg-[#1c1c1e]/95 dark:shadow-[0_8px_32px_rgba(0,0,0,0.30)]"
          >
            <div className="flex items-start gap-3">
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="mt-0.5 h-5 w-5 shrink-0 text-[#d70015] dark:text-[#ff6961]">
                <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
                <path d="M10 5.5v5M10 14h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span className="min-w-0 flex-1 break-words text-[13px] leading-5">{state.error}</span>
              <button
                type="button"
                aria-label="Dismiss warning"
                onClick={() => setState(prev => ({ ...prev, error: null }))}
                className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-subtle transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0071e3] dark:hover:bg-white/10"
              >
                <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3 w-3">
                  <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Quantity Selection Modal */}
        {state.quantitySelectNFT && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
            <div className="glass-card rounded-2xl p-4 w-full max-w-xs shadow-2xl">
              <h3 className="text-lg font-semibold text-white mb-4 text-center">
                Select Quantity
              </h3>
              <div className="flex flex-col items-center gap-4 mb-6">
                <div className="w-24 h-24 rounded-lg overflow-hidden shadow-lg">
                  <img
                    src={state.quantitySelectNFT.image || '/placeholder.svg'}
                    alt={state.quantitySelectNFT.name || 'NFT'}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="text-center">
                  <p className="font-medium text-white">
                    {state.quantitySelectNFT.name || `NFT #${state.quantitySelectNFT.tokenId}`}
                  </p>
                  <p className="text-sm text-gray-300">
                    Available: {state.quantitySelectNFT.ownedCount}
                  </p>
                </div>
                <div className="flex items-center gap-3 mt-2">
                  <button
                    onClick={() => {
                      const current = typeof tempQuantity === 'number' ? tempQuantity : parseInt(tempQuantity.toString()) || 1;
                      setTempQuantity(Math.max(1, current - 1));
                    }}
                    disabled={typeof tempQuantity === 'number' ? tempQuantity <= 1 : parseInt(tempQuantity.toString()) <= 1}
                    className="w-10 h-10 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white flex items-center justify-center text-xl font-bold disabled:opacity-50"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    value={tempQuantity}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      if (!isNaN(val)) {
                        setTempQuantity(Math.min(Math.max(1, val), state.quantitySelectNFT?.ownedCount || 1));
                      } else {
                        setTempQuantity('');
                      }
                    }}
                    min={1}
                    max={state.quantitySelectNFT.ownedCount}
                    className="w-20 text-center bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg py-1 text-gray-900 dark:text-gray-100"
                  />
                  <button
                    onClick={() => {
                      const current = typeof tempQuantity === 'number' ? tempQuantity : parseInt(tempQuantity.toString()) || 1;
                      setTempQuantity(Math.min(state.quantitySelectNFT?.ownedCount || 1, current + 1));
                    }}
                    disabled={typeof tempQuantity === 'number' ? tempQuantity >= (state.quantitySelectNFT?.ownedCount || 1) : false}
                    className="w-10 h-10 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white flex items-center justify-center text-xl font-bold disabled:opacity-50"
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={closeQuantityModal}
                  className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const qty = typeof tempQuantity === 'number' ? tempQuantity : parseInt(tempQuantity.toString()) || 1;
                    handleQuantitySelect(qty);
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}

        {offerWait && (
          <div className="fixed inset-0 z-[100001] flex items-end justify-center bg-black/65 p-4 sm:items-center">
            <div className="w-full max-w-[360px] overflow-hidden rounded-[28px] border border-black/[0.08] bg-[#ffffff] px-5 pb-6 pt-7 text-center shadow-[0_24px_80px_rgba(0,0,0,0.28)] dark:border-white/12 dark:bg-[#1c1c1e]">
              <div
                aria-hidden="true"
                className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-[#0071e3]/25 border-t-[#0071e3]"
              />
              <h3 className="mt-4 text-[21px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
                {offerWait === 'wallet'
                  ? 'Confirm in your wallet'
                  : offerWait === 'chain'
                    ? 'Please wait'
                    : 'Creating your link'}
              </h3>
              <p className="mx-auto mt-2 max-w-[280px] text-[14px] leading-[1.4] text-[#6e6e73] dark:text-[#a1a1a6]">
                {offerWait === 'wallet'
                  ? 'Approve the transaction, then stay on this page. Closing now can lose the offer link.'
                  : offerWait === 'chain'
                    ? 'Wallet confirmed. Your offer is landing on-chain. Don’t close this tab.'
                    : 'Please wait. Creating your trade link now. Don’t close this tab.'}
              </p>
            </div>
          </div>
        )}

        {/* Confirm offer */}
        {confirmOffer && (
          <div
            className="fixed inset-0 z-[100000] flex items-end justify-center bg-black/55 p-4 sm:items-center"
            onClick={() => !isProposing && setConfirmOffer(false)}
          >
            <div
              className="w-full max-w-[340px] overflow-hidden rounded-[28px] border border-black/[0.08] bg-[#ffffff] px-5 pb-5 pt-6 text-center shadow-[0_24px_80px_rgba(0,0,0,0.22)] dark:border-white/12 dark:bg-[#1c1c1e] dark:shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-[21px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
                {counterFromId ? 'Send counter' : 'You’re trading'}
              </h3>
              <p className="mx-auto mt-1.5 max-w-[260px] text-[13px] leading-[1.35] text-[#6e6e73] dark:text-[#a1a1a6]">
                {counterFromId
                  ? 'This sends a new offer back. The old one closes.'
                  : 'Confirm in your wallet to send this offer.'}
                {` Link lasts ${offerDurationLabel(offerDuration)}.`}
              </p>
              <ConfirmTradeSides
                offer={state.userSelectedNFTs}
                receive={state.counterpartySelectedNFTs}
                offerEth={state.userMonadAmount}
                receiveEth={state.counterpartyMonadAmount}
                offerChog={state.userChogAmount}
                receiveChog={state.counterpartyChogAmount}
                nativeSymbol={network === 'monad' ? 'MON' : 'ETH'}
              />
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={isProposing}
                  onClick={() => setConfirmOffer(false)}
                  className="h-[44px] rounded-full bg-black/[0.06] text-[15px] font-medium text-[#1d1d1f] dark:bg-white/10 dark:text-[#f5f5f7]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isProposing}
                  onClick={handleProposeTrade}
                  className="h-[44px] rounded-full bg-[#0071e3] text-[15px] font-medium text-white"
                >
                  {isProposing ? 'Confirming…' : counterFromId ? 'Send' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Share Modal */}
        {shareModalUrl && (
          <div
            className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/40 p-4 backdrop-blur-[24px] sm:items-center"
            onClick={() => setShareModalUrl(null)}
          >
            <div
              className="glass w-full max-w-[380px] rounded-[32px] px-6 pb-6 pt-7 text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-[28px] font-semibold tracking-tight text-[#f5f5f7]">
                {shareWasCounter ? 'Counter sent' : 'Offer sent'}
              </h3>
              <p className="mx-auto mt-2 max-w-[280px] text-[17px] leading-[1.35] tracking-[-0.022em] text-[#86868b]">
                Share the link so they can open and accept.
              </p>

              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(shareModalUrl);
                  toast.success('Copied', { duration: 1800, position: 'top-center' });
                }}
                className="glass-pill mt-7 w-full rounded-[18px] px-4 py-3.5 text-left"
              >
                <p className="text-[11px] text-[#86868b]">Copy link</p>
                <p className="mt-0.5 truncate font-mono text-[13px] text-[#f5f5f7]">
                  {shareModalUrl.replace(/^https?:\/\//, '')}
                </p>
                <p className="mt-1.5 text-[12px] text-[#86868b]">Tap to copy, then paste it to them</p>
              </button>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setShareModalUrl(null)}
                  className="h-[50px] rounded-full bg-white/10 text-[17px] font-medium text-[#f5f5f7]"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const tradeId = shareModalUrl.split('/').pop();
                    window.location.href = '/activity?sent=1';
                  }}
                  className="h-[50px] rounded-full bg-[#0071e3] text-[17px] font-medium text-white"
                >
                  View
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Trade Limits Info Modal */}
        {showLimitInfo && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
            <div className="glass-card rounded-xl p-6 max-w-md w-full shadow-2xl">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-medium text-white flex items-center gap-2">
                  <span className="text-blue-400">ℹ️</span>
                  Trade Limits
                </h3>
                <button
                  onClick={() => setShowLimitInfo(false)}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                    <span className="text-white font-bold text-sm">{MAX_NFTS_PER_SIDE}</span>
                  </div>
                  <div>
                    <p className="text-gray-200 font-medium mb-1">
                      Maximum NFTs per side
                    </p>
                    <p className="text-gray-300 text-sm">
                      Each side can offer up to <strong>{MAX_NFTS_PER_SIDE} NFTs</strong> in a single trade.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-green-600 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                    <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-gray-200 font-medium mb-1">
                      Why this limit?
                    </p>
                    <p className="text-gray-300 text-sm">
                      This ensures optimal performance and gas efficiency for all trades on the platform.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end mt-6">
                <button
                  onClick={() => setShowLimitInfo(false)}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                >
                  Got it
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import WalletButton from '../WalletButton';
import SafeImage from '../SafeImage';
import Spotlight from '../Spotlight';
import type { VerifiedNFTHolding } from '../../../services/verifiedNFTChecker';
import { MAX_IN_WALLET_OFFER_DURATION, OFFER_DURATIONS } from '@/lib/offerExpiry';
import { shortWallet } from '@/lib/ens';
import { NATIVE_TOKEN_SYMBOL } from '@/lib/chain';
import { useAppNetwork } from '../../context/NetworkPrefContext';
import { isERC1155NFT } from '../../config/verifiedNFTs';
import OpenSeaItemButton from '../OpenSeaItemButton';
import { isEtaCollection, showsFreeTrade } from '@/lib/freeTrade';

type TokenPick = {
  tokenId: string;
  name: string;
  description: string;
  image: string;
  collectionId: string;
  contractAddress: string;
  ownership: { tokenCount: string };
  floorPrice: number;
  selectedCount: number;
  ownedCount: number;
  collectionName: string;
  isCounterparty: boolean;
  standard: 'ERC721' | 'ERC1155';
  balance: string;
};

type Selected = {
  tokenId: string;
  contractAddress: string;
  name?: string;
  image?: string;
  selectedCount: number;
  floorPrice?: number;
};

function formatWalletEth(value?: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '0';
  const text = amount >= 0.01 ? amount.toFixed(4) : amount.toFixed(6);
  return text.replace(/\.?0+$/, '') || '0';
}

function EthField({
  value,
  onChange,
  balance,
  overMessage,
  extraNeed = 0,
  disabled = false,
  symbol,
  chips = ['0.001', '0.01'],
}: {
  value: string;
  onChange: (value: string) => void;
  balance?: string;
  overMessage?: string;
  extraNeed?: number;
  disabled?: boolean;
  symbol?: string;
  chips?: string[];
}) {
  const amount = Number(value) || 0;
  const wallet = Number(balance);
  const hasBalance = balance !== undefined && Number.isFinite(wallet) && wallet >= 0;
  const over = Boolean(overMessage && Number.isFinite(amount) && hasBalance && amount + extraNeed > wallet);
  const network = useAppNetwork();
  const tokenSymbol = symbol || (network === 'monad' ? 'MON' : NATIVE_TOKEN_SYMBOL);

  return (
    <div className="mt-3">
      <div className="flex items-center gap-1.5">
        <span className="w-10 shrink-0 text-[11px] text-[#86868b]">{tokenSymbol}</span>
        <input
          type="number"
          min="0"
          step="0.001"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="0"
          className={`h-7 w-20 shrink-0 rounded-full px-2.5 text-[13px] tabular-nums text-[#f5f5f7] outline-none placeholder:text-[#6e6e73] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
            over ? 'bg-[#ff453a]/15 ring-1 ring-[#ff453a]/40' : 'bg-white/8'
          }`}
        />
        {hasBalance ? (
          <span className={`min-w-0 truncate text-[11px] tabular-nums ${over ? 'text-[#ff453a]' : 'text-[#6e6e73]'}`}>
            {formatWalletEth(balance)}
          </span>
        ) : null}
        <div className="ml-auto flex shrink-0 gap-1">
          {chips.map((chip) => (
            <button
              key={chip}
              type="button"
              disabled={disabled}
              onClick={() => {
                const next = (Number(value) || 0) + Number(chip);
                onChange(next.toFixed(6).replace(/\.?0+$/, '') || chip);
              }}
              className="h-6 rounded-full bg-white/6 px-2 text-[10px] text-[#a1a1a6] hover:bg-white/12 hover:text-[#f5f5f7]"
            >
              +{chip}
            </button>
          ))}
        </div>
      </div>
      {over ? <p className="mt-1.5 pl-8 text-[11px] leading-4 text-[#ff453a]">{overMessage}</p> : null}
    </div>
  );
}

function toPick(holding: VerifiedNFTHolding, token: VerifiedNFTHolding['tokens'][0], isCounterparty: boolean): TokenPick {
  return {
    tokenId: token.tokenId,
    name: token.name,
    description: '',
    image: token.image,
    collectionId: holding.collectionId,
    contractAddress: holding.collectionId,
    ownership: { tokenCount: token.tokenCount },
    floorPrice: token.floorPrice / 1000,
    selectedCount: 0,
    ownedCount: parseInt(token.tokenCount, 10) || 1,
    collectionName: holding.collectionName,
    isCounterparty,
    standard: isERC1155NFT(holding.collectionId) ? 'ERC1155' : 'ERC721',
    balance: token.tokenCount,
  };
}

function flattenSlots(items: Selected[]) {
  return items.flatMap((item) => Array.from({ length: item.selectedCount || 1 }, () => item));
}

type CollectionOption = {
  id: string;
  name: string;
  image: string;
  count: number;
  openseaVerified?: boolean;
  floorEth?: number;
  floorSymbol?: string;
  slug?: string;
};

function looksGenerated(name: string) {
  return /-\d{6,}$/.test(String(name || '')) || /^\d+$/.test(String(name || ''));
}

function prettyCollectionName(name?: string, slug?: string) {
  const raw = String(name || slug || '').trim();
  if (!raw) return 'Collection';
  const slugLike = /[-_]/.test(raw) && !/\s/.test(raw);
  const source = slugLike ? raw.replace(/-\d{5,}$/, '') : raw;
  const spaced = source.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!spaced) return raw;
  return spaced.replace(/\b[a-z0-9]/g, (letter) => letter.toUpperCase());
}

function collectionRank(collection: CollectionOption) {
  if (collection.openseaVerified) return 0;
  if ((collection.floorEth || 0) > 0) return 1;
  if (looksGenerated(collection.name) || looksGenerated(collection.slug || '')) return 3;
  return 2;
}

function floorCurrencyRank(collection: CollectionOption) {
  if (!(collection.floorEth || 0)) return 2;
  const symbol = String(collection.floorSymbol || '').toUpperCase();
  if (symbol === 'ETH' || symbol === 'WETH') return 0;
  return 1;
}

function compareCollections(a: CollectionOption, b: CollectionOption) {
  const rank = collectionRank(a) - collectionRank(b);
  if (rank) return rank;
  const currency = floorCurrencyRank(a) - floorCurrencyRank(b);
  if (currency) return currency;
  if ((b.floorEth || 0) !== (a.floorEth || 0)) return (b.floorEth || 0) - (a.floorEth || 0);
  if (b.count !== a.count) return b.count - a.count;
  return a.name.localeCompare(b.name);
}

function sortCollections(collections: CollectionOption[]) {
  return [...collections].sort(compareCollections);
}

function formatFloor(floorEth?: number, symbol = 'USDG') {
  if (!floorEth || floorEth <= 0) return '';
  const unit = symbol.toUpperCase();
  const amount = floorEth >= 0.01 ? floorEth.toFixed(2) : floorEth.toFixed(4);
  return `${amount} ${unit}`;
}

function FreeTradeMark({ kind }: { kind: 'chog' | 'eta' }) {
  return (
    <span
      title={kind === 'eta' ? 'eta stays free on every chain' : 'Chog stays free on Monad'}
      className="inline-flex shrink-0 rounded-full bg-white/8 px-1.5 py-0.5 text-[10px] font-medium leading-none text-[#c7c7cc]"
    >
      Free
    </span>
  );
}

function OpenSeaVerifiedMark() {
  return (
    <span className="group/verified relative inline-flex shrink-0">
      <span
        aria-label="OpenSea verified"
        className="inline-flex items-center gap-1 rounded-full bg-[#2081e2]/12 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[#2081e2] dark:bg-[#2081e2]/20"
      >
        <img src="/opensea-logo.png" alt="" className="h-3 w-3 object-contain" />
        OpenSea verified
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-md bg-black px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/verified:opacity-100"
      >
        OpenSea verified
      </span>
    </span>
  );
}

function CollectionThumb({ src, brand }: { src?: string; brand?: 'robinhood' | 'monad' }) {
  if (brand === 'monad') {
    return (
      <span className="relative grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-white/8 p-1">
        <SafeImage src="/images/monad-logo.png" alt="" className="h-full w-full object-contain" />
      </span>
    );
  }
  if (brand === 'robinhood') {
    return (
      <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-[10px] bg-[#ccff00]">
        <SafeImage src="/images/robinhood-chain.png" alt="" className="h-full w-full object-cover" />
      </span>
    );
  }
  return (
    <span className="glass-slot relative h-8 w-8 shrink-0 overflow-hidden rounded-[10px]">
      {src ? (
        <SafeImage src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="absolute inset-0 bg-white/8" />
      )}
    </span>
  );
}

function CollectionFilter({
  collections,
  activeId,
  totalItems,
  open,
  onToggle,
  onClose,
  onSelect,
}: {
  collections: CollectionOption[];
  activeId: string;
  totalItems: number;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const network = useAppNetwork();
  const chainBrand = network === 'monad' ? 'monad' : 'robinhood';
  const active = collections.find((collection) => collection.id === activeId);
  const triggerCount = active ? active.count : totalItems;

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open, onClose]);

  return (
    <div ref={rootRef} className="relative mb-5">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={onToggle}
        className="glass-pill flex h-11 w-full items-center gap-2.5 rounded-full py-0 pl-1.5 pr-3 text-left outline-none"
      >
        <CollectionThumb src={active?.image} brand={active ? undefined : chainBrand} />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="min-w-0 truncate text-[14px]">
            {active ? prettyCollectionName(active.name, active.slug) : 'All collections'}
          </span>
          {active?.openseaVerified && <OpenSeaVerifiedMark />}
          {active && showsFreeTrade(active, network) && (
            <FreeTradeMark kind={isEtaCollection(active) ? 'eta' : 'chog'} />
          )}
        </span>
        <span className="shrink-0 text-[12px] text-[#86868b]">
          {triggerCount} {triggerCount === 1 ? 'item' : 'items'}
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          className={`h-4 w-4 shrink-0 text-[#86868b] transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Collections"
          className="absolute inset-x-0 top-[calc(100%+8px)] z-20 max-h-[min(420px,70vh)] overflow-y-auto overscroll-contain rounded-[22px] border border-black/[0.08] bg-[#ffffff] p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.16)] thin-scrollbar dark:border-white/10 dark:bg-[#1c1c1e] dark:shadow-[0_16px_40px_rgba(0,0,0,0.55)]"
        >
          <button
            type="button"
            role="option"
            aria-selected={activeId === 'all'}
            onClick={() => onSelect('all')}
            className={`sticky top-0 z-10 flex w-full items-center gap-3 rounded-[14px] px-2 py-2 text-left ${
              activeId === 'all' ? 'bg-[#f2f2f7] dark:bg-[#2c2c2e]' : 'bg-[#ffffff] hover:bg-black/[0.03] dark:bg-[#1c1c1e] dark:hover:bg-white/[0.05]'
            }`}
          >
            <CollectionThumb brand={chainBrand} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px]">All collections</span>
              <span className="block text-[11px] text-[#86868b]">
                {totalItems} {totalItems === 1 ? 'item' : 'items'}
              </span>
            </span>
            {activeId === 'all' && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white" />}
          </button>
          <div className="mx-2 my-1 h-px bg-black/[0.06] dark:bg-white/10" />
          {collections.map((collection) => (
            <button
              key={collection.id}
              type="button"
              role="option"
              aria-selected={activeId === collection.id}
              onClick={() => onSelect(collection.id)}
              className={`mt-0.5 flex w-full items-center gap-3 rounded-[14px] px-2 py-2 text-left ${
                activeId === collection.id ? 'bg-black/[0.04] dark:bg-white/8' : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.05]'
              }`}
            >
              <CollectionThumb src={collection.image} />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 truncate text-[14px]">
                    {prettyCollectionName(collection.name, collection.slug)}
                  </span>
                  {collection.openseaVerified && <OpenSeaVerifiedMark />}
                  {showsFreeTrade(collection, network) && (
                    <FreeTradeMark kind={isEtaCollection(collection) ? 'eta' : 'chog'} />
                  )}
                </span>
                <span className="block text-[11px] text-[#86868b]">
                  {collection.count} {collection.count === 1 ? 'item' : 'items'}
                  {formatFloor(collection.floorEth, collection.floorSymbol)
                    ? ` · FP ${formatFloor(collection.floorEth, collection.floorSymbol)}`
                    : ''}
                </span>
              </span>
              {activeId === collection.id && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const SLOTS = 8;

function SlotGrid({
  items,
  onRemove,
}: {
  items: Selected[];
  onRemove: (item: Selected) => void;
}) {
  const filled = flattenSlots(items);
  const cells = Array.from({ length: SLOTS }, (_, i) => filled[i] || null);

  return (
    <div className="grid grid-cols-4 gap-2">
      {cells.map((item, i) =>
        item ? (
          <div
            key={`${item.contractAddress}-${item.tokenId}-${i}`}
            className="relative isolate aspect-square w-full overflow-hidden rounded-[18px]"
          >
            <button
              onClick={() => onRemove(item)}
              className="group relative h-full w-full overflow-hidden rounded-[18px] glass-slot transition duration-200 hover:brightness-110"
              title="Remove"
            >
              <SafeImage src={item.image || '/placeholder.svg'} alt={item.name || ''} className="h-full w-full object-cover" />
              <span className="absolute inset-0 hidden items-center justify-center bg-black/35 text-[12px] text-white group-hover:flex">
                Remove
              </span>
            </button>
            <OpenSeaItemButton contract={item.contractAddress} tokenId={item.tokenId} className="h-6 w-6" />
          </div>
        ) : (
          <div key={`empty-${i}`} className="aspect-square w-full rounded-[18px] glass-slot" />
        )
      )}
    </div>
  );
}

export default function TradeBoard({
  userAddress,
  counterpartyAddress,
  onCounterpartyChange,
  userHoldings,
  theirHoldings,
  userLoading,
  theirLoading,
  userSelected,
  theirSelected,
  onPickUser,
  onPickTheir,
  onRemoveUser,
  onRemoveTheir,
  userEth,
  theirEth,
  onUserEth,
  onTheirEth,
  userChog = '',
  theirChog = '',
  onUserChog,
  onTheirChog,
  userBalance,
  theirBalance,
  userChogBalance,
  theirChogBalance,
  protocolFee = '',
  feeWaived = false,
  canTrade,
  isTrading,
  onTrade,
  tradingWithSelf = false,
  onClear,
  tradeMode,
  onTradeModeChange,
  escrowReady,
  checkingSends,
  blockedSends,
  sendChecks,
  offerDuration,
  onOfferDurationChange,
  isCountering = false,
  ensLookup,
  resolvedAddress,
}: {
  userAddress: string;
  counterpartyAddress: string;
  onCounterpartyChange: (value: string) => void;
  userHoldings: VerifiedNFTHolding[];
  theirHoldings: VerifiedNFTHolding[];
  userLoading: boolean;
  theirLoading: boolean;
  userSelected: Selected[];
  theirSelected: Selected[];
  onPickUser: (nft: TokenPick) => void;
  onPickTheir: (nft: TokenPick) => void;
  onRemoveUser: (item: Selected) => void;
  onRemoveTheir: (item: Selected) => void;
  userEth: string;
  theirEth: string;
  onUserEth: (value: string) => void;
  onTheirEth: (value: string) => void;
  userChog?: string;
  theirChog?: string;
  onUserChog?: (value: string) => void;
  onTheirChog?: (value: string) => void;
  userBalance: string;
  theirBalance: string;
  userChogBalance?: string;
  theirChogBalance?: string;
  protocolFee?: string;
  feeWaived?: boolean;
  canTrade: boolean;
  isTrading: boolean;
  onTrade: () => void;
  tradingWithSelf?: boolean;
  onClear: () => void;
  tradeMode: 'stay-in-wallet' | 'escrow';
  onTradeModeChange: (mode: 'stay-in-wallet' | 'escrow') => void;
  escrowReady: boolean;
  checkingSends?: boolean;
  blockedSends?: string[];
  sendChecks?: Array<{ name?: string; operatorSend: 'open' | 'blocked' | 'unknown' }>;
  offerDuration: number;
  onOfferDurationChange: (seconds: number) => void;
  isCountering?: boolean;
  ensLookup?: { status: 'idle' | 'loading' | 'ok' | 'missing'; name: string };
  resolvedAddress?: string;
}) {
  const [tab, setTab] = useState<'yours' | 'theirs'>('yours');
  const [query, setQuery] = useState('');
  const [collectionByTab, setCollectionByTab] = useState<Record<'yours' | 'theirs', string>>({
    yours: 'all',
    theirs: 'all',
  });
  const [collectionListOpen, setCollectionListOpen] = useState(false);
  const network = useAppNetwork();

  useEffect(() => {
    setCollectionListOpen(false);
  }, [tab]);

  const resolvedWallet = (resolvedAddress || '').trim();
  const theirReady = /^0x[a-fA-F0-9]{40}$/.test(resolvedWallet);
  const tokenSymbol = network === 'monad' ? 'MON' : NATIVE_TOKEN_SYMBOL;
  const protocolFeeAmount = Number(protocolFee.replace(new RegExp(` ${tokenSymbol}$`, 'i'), '')) || 0;
  const feeToAdd = feeWaived ? 0 : protocolFeeAmount;
  const userEthOver =
    Number.isFinite(Number(userEth || 0)) &&
    Number.isFinite(Number(userBalance)) &&
    Number(userEth || 0) + feeToAdd > Number(userBalance);
  const viewingYours = tab === 'yours';
  const holdings = viewingYours ? userHoldings : theirHoldings;
  const selected = viewingYours ? userSelected : theirSelected;
  const loading = viewingYours ? userLoading : theirLoading;
  const connected = viewingYours ? !!userAddress : theirReady;
  const activeCollection = collectionByTab[tab];

  const collections = useMemo(() => {
    const byId = new Map<string, CollectionOption>();
    for (const holding of holdings) {
      const id = holding.collectionId.toLowerCase();
      const current = byId.get(id);
      const count = holding.tokens.length;
      if (current) {
        current.count += count;
        continue;
      }
      byId.set(id, {
        id,
        name: holding.collectionName || 'Unnamed collection',
        image: holding.collectionImage || holding.tokens[0]?.image || '',
        count,
        openseaVerified: holding.openseaVerified === true,
        floorEth: holding.collectionFloorPrice || 0,
        floorSymbol: holding.collectionFloorSymbol || 'USDG',
        slug: holding.collectionSlug || holding.collectionName || '',
      });
    }
    return sortCollections([...byId.values()]);
  }, [holdings]);
  const totalItems = holdings.reduce((total, holding) => total + holding.tokens.length, 0);

  const selectCollection = (collectionId: string) => {
    setCollectionByTab((current) => ({ ...current, [tab]: collectionId }));
    setCollectionListOpen(false);
  };

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const seen = new Set<string>();
    const ordered = [...holdings].sort((a, b) =>
      compareCollections(
        {
          id: a.collectionId,
          name: a.collectionName,
          image: '',
          count: a.tokens.length,
          openseaVerified: a.openseaVerified,
          floorEth: a.collectionFloorPrice,
          floorSymbol: a.collectionFloorSymbol,
          slug: a.collectionSlug,
        },
        {
          id: b.collectionId,
          name: b.collectionName,
          image: '',
          count: b.tokens.length,
          openseaVerified: b.openseaVerified,
          floorEth: b.collectionFloorPrice,
          floorSymbol: b.collectionFloorSymbol,
          slug: b.collectionSlug,
        }
      )
    );
    return ordered.flatMap((holding) =>
      (activeCollection === 'all' || holding.collectionId.toLowerCase() === activeCollection.toLowerCase()
        ? holding.tokens
        : [])
        .filter((token) => {
          const key = `${holding.collectionId.toLowerCase()}-${token.tokenId}`;
          if (seen.has(key)) return false;
          seen.add(key);
          if (!q) return true;
          return (
            token.name.toLowerCase().includes(q) ||
            token.tokenId.toLowerCase().includes(q) ||
            holding.collectionName.toLowerCase().includes(q)
          );
        })
        .map((token) => ({ holding, token }))
    );
  }, [holdings, query, activeCollection]);

  return (
    <div className="glass-page min-h-[calc(100vh-48px)] text-[#f5f5f7]">
      <div className="mx-auto grid max-w-[1180px] grid-cols-1 gap-6 px-6 py-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <Spotlight className="glass rounded-[28px] p-5 sm:p-6">
          <div className="glass-pill mb-5 flex rounded-full p-1">
            <button
              onClick={() => setTab('yours')}
              className={`flex-1 rounded-full py-2 text-[13px] ${
                viewingYours ? 'bg-white/15 text-white' : 'text-[#86868b]'
              }`}
            >
              Your inventory
            </button>
            <button
              onClick={() => setTab('theirs')}
              className={`flex-1 rounded-full py-2 text-[13px] ${
                !viewingYours ? 'bg-white/15 text-white' : 'text-[#86868b]'
              }`}
            >
              Their inventory
            </button>
          </div>

          {!viewingYours && (
            <>
              <input
                value={counterpartyAddress}
                onChange={(e) => onCounterpartyChange(e.target.value)}
                placeholder="Paste their address or name.eth"
                className={`glass-pill mb-2 h-11 w-full rounded-full px-4 font-mono text-[13px] outline-none placeholder:text-[#6e6e73] ${
                  tradingWithSelf || ensLookup?.status === 'missing' ? 'ring-1 ring-[#ff453a]/70' : ''
                }`}
              />
              {ensLookup?.status === 'loading' ? (
                <p className="mb-4 text-[13px] text-[#86868b]">Looking up {ensLookup.name}…</p>
              ) : ensLookup?.status === 'ok' && theirReady ? (
                <p className="mb-4 text-[13px] text-[#86868b]">
                  {ensLookup.name} → {shortWallet(resolvedWallet)}
                </p>
              ) : ensLookup?.status === 'missing' ? (
                <p className="mb-4 text-[13px] text-[#ff6961]">No wallet found for that ENS name.</p>
              ) : tradingWithSelf ? (
                <p className="mb-4 text-[13px] text-[#ff6961]">
                  That’s your wallet. Paste a different address to trade with someone else.
                </p>
              ) : (
                <div className="mb-2" />
              )}
            </>
          )}

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="glass-pill mb-5 h-11 w-full rounded-full px-4 text-[14px] outline-none placeholder:text-[#6e6e73]"
          />

          {collections.length > 0 && (
            <CollectionFilter
              collections={collections}
              activeId={activeCollection}
              totalItems={totalItems}
              open={collectionListOpen}
              onToggle={() => setCollectionListOpen((open) => !open)}
              onClose={() => setCollectionListOpen(false)}
              onSelect={selectCollection}
            />
          )}

          {connected && items.length > 0 && (
            <p className="mb-3 px-1 text-[12px] leading-snug text-[#86868b]">
              Avoid fakes. Click the OpenSea logo and check the NFT before you trade.
            </p>
          )}

          {!connected ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center px-6 text-center sm:min-h-[420px]">
              <p className="text-[28px] font-semibold tracking-tight">
                {viewingYours ? 'Your inventory.' : 'Their inventory.'}
              </p>
              <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-[#86868b]">
                {viewingYours
                  ? 'Connect to choose items you will send.'
                  : 'Paste a wallet or a .eth name to choose items you want.'}
              </p>
              {viewingYours && (
                <div className="mt-6">
                  <WalletButton />
                </div>
              )}
            </div>
          ) : loading ? (
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length: 16 }).map((_, i) => (
                <div key={i} className="aspect-square w-full animate-pulse rounded-[18px] glass-slot" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex min-h-[320px] items-center justify-center text-[15px] text-[#86868b]">
              No items here
            </div>
          ) : (
            <div className="grid max-h-[860px] grid-cols-4 gap-2 overflow-y-auto thin-scrollbar">
              {items.map(({ holding, token }) => {
                const isOn = selected.some(
                  (s) => s.tokenId === token.tokenId && s.contractAddress === holding.collectionId
                );
                return (
                  <div key={`${holding.collectionId}-${token.tokenId}`} className="group relative isolate z-[2] aspect-square min-w-0 overflow-hidden rounded-[18px]">
                    <button
                      disabled={!viewingYours && tradingWithSelf}
                      onClick={() => {
                        if (!viewingYours && tradingWithSelf) return;
                        (viewingYours ? onPickUser : onPickTheir)(toPick(holding, token, !viewingYours));
                      }}
                      className={`absolute inset-0 z-[2] overflow-hidden rounded-[18px] glass-slot ${
                        !viewingYours && tradingWithSelf ? 'cursor-not-allowed opacity-40' : ''
                      } ${isOn ? 'ring-2 ring-inset ring-white/55' : ''}`}
                      title={!viewingYours && tradingWithSelf ? 'You can’t add items when this is your own wallet' : token.name}
                    >
                      <SafeImage
                        src={token.image || '/placeholder.svg'}
                        alt={token.name}
                        className="h-full w-full object-cover transition duration-200 ease-out will-change-transform group-hover:scale-[1.04] group-hover:brightness-110"
                      />
                    </button>
                    <OpenSeaItemButton contract={holding.collectionId} tokenId={token.tokenId} className="h-6 w-6" />
                    <span className="pointer-events-none absolute left-1.5 top-1.5 z-[5] inline-flex max-w-[calc(100%-12px)] items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 opacity-0 backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100">
                      <span className="truncate text-[10px] font-medium text-white">
                        {token.name && token.name.includes(String(token.tokenId))
                          ? token.name
                          : `${token.name || holding.collectionName || 'NFT'} #${token.tokenId}`}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Spotlight>

        <Spotlight className="glass flex flex-col rounded-[28px] p-5 sm:p-6">
          <div className="trade-item-glow">
            <p className="text-[21px] font-semibold tracking-tight">Your items</p>
            <p className="mt-1 mb-4 text-[13px] text-[#86868b]">What you send</p>
            <SlotGrid items={userSelected} onRemove={onRemoveUser} />
            <EthField
              value={userEth}
              onChange={onUserEth}
              balance={userBalance}
              extraNeed={feeToAdd}
              overMessage={`Not enough ${tokenSymbol}.`}
            />
            {network === 'monad' && onUserChog ? (
              <EthField
                value={userChog}
                onChange={onUserChog}
                balance={userChogBalance}
                symbol="CHOG"
                chips={['100', '1000', '10000']}
                overMessage="Not enough CHOG."
              />
            ) : null}
            {protocolFee && !feeWaived ? (
              <p className={`mt-2 text-[11px] ${userEthOver ? 'text-[#ff6961]' : 'text-[#86868b]'}`}>
                {userEthOver ? `Not enough ${tokenSymbol}. ` : ''}
                Protocol fee {protocolFee} on create.
              </p>
            ) : (
              <p className="mt-2 text-[11px] text-[#86868b]">
                {network === 'monad'
                  ? 'Beta. No protocol fee. Free for Chog on Monad, eta on every chain.'
                  : 'Free for eta holders on every chain.'}
              </p>
            )}
          </div>

          <div className="my-8 flex items-center justify-center text-[#df514a]">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </div>

          <div className="trade-item-glow flex-1">
            <p className="text-[21px] font-semibold tracking-tight">Their items</p>
            <p className="mt-1 mb-4 text-[13px] text-[#86868b]">What you get</p>
            <SlotGrid items={theirSelected} onRemove={onRemoveTheir} />
            <EthField
              value={theirEth}
              onChange={onTheirEth}
              balance={theirReady ? theirBalance : undefined}
              disabled={tradingWithSelf}
              overMessage={theirReady ? `They don’t have enough ${tokenSymbol} for this trade.` : undefined}
            />
            {network === 'monad' && onTheirChog ? (
              <EthField
                value={theirChog}
                onChange={onTheirChog}
                balance={theirReady ? theirChogBalance : undefined}
                symbol="CHOG"
                chips={['100', '1000', '10000']}
                disabled={tradingWithSelf}
                overMessage={theirReady ? 'They don’t have enough CHOG for this trade.' : undefined}
              />
            ) : null}
          </div>

          <div className="mt-10 flex flex-col items-center gap-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#86868b]">How this offer works</p>
            <div className="grid w-full gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={Boolean(blockedSends?.length)}
                onClick={() => onTradeModeChange('stay-in-wallet')}
                className={`rounded-[18px] px-3 py-3 text-left ${
                  tradeMode === 'stay-in-wallet' ? 'bg-white/12 ring-1 ring-white/20' : 'bg-white/5'
                } ${blockedSends?.length ? 'cursor-not-allowed opacity-45' : ''}`}
              >
                <p className="text-[13px] font-semibold">In wallet</p>
                <p className="mt-1 text-[11px] leading-4 text-[#86868b]">
                  {blockedSends?.length
                    ? 'Off for this collection. Use Escrow.'
                    : 'NFTs stay with you until they accept. Start here.'}
                </p>
              </button>
              <button
                type="button"
                onClick={() => onTradeModeChange('escrow')}
                className={`rounded-[18px] px-3 py-3 text-left ${
                  tradeMode === 'escrow' ? 'bg-white/12 ring-1 ring-white/20' : 'bg-white/5'
                }`}
              >
                <p className="text-[13px] font-semibold">Escrow</p>
                <p className="mt-1 text-[11px] leading-4 text-[#86868b]">
                  You deposit now. They deposit on accept. Then both sides swap.
                </p>
              </button>
            </div>
            <div className="max-w-[360px] space-y-1.5 text-center text-[11px] leading-4 text-[#86868b]">
              {checkingSends
                ? <p>Checking whether these collections allow an In-wallet send…</p>
                : sendChecks?.length
                  ? sendChecks.map((check, index) => (
                      <p key={`${check.name || 'collection'}-${index}`}>
                        <span className="font-medium text-[#c7c7cc]">{check.name || 'This collection'}</span>
                        {check.operatorSend === 'blocked'
                          ? ' — blocks a direct send. Use Escrow.'
                          : check.operatorSend === 'open'
                            ? ' — In wallet is fine after you approve.'
                            : ' — could not be checked yet.'}
                      </p>
                    ))
                  : blockedSends?.length
                    ? <p>
                        {escrowReady
                          ? `${blockedSends.join(', ')} ${blockedSends.length === 1 ? 'blocks' : 'block'} a direct send. This offer is Escrow only.`
                          : `${blockedSends.join(', ')} ${blockedSends.length === 1 ? 'needs' : 'need'} Escrow. Publish EtaSwap Escrow V1 in Settings first.`}
                      </p>
                  : tradeMode !== 'escrow'
                    ? <p>If a collection locks operator transfers, send the same offer as Escrow.</p>
                    : escrowReady
                      ? <p>Your NFTs leave your wallet when you send. Cancel, then claim them back if they never accept.</p>
                      : (
                        <p>
                          Publish EtaSwap Escrow V1 in{' '}
                          <Link href="/settings" className="underline hover:text-ink">
                            Settings
                          </Link>
                          {' '}before using this mode.
                        </p>
                      )}
            </div>
            <div className="w-full">
              <p className="mb-2 text-center text-[11px] font-medium uppercase tracking-[0.14em] text-[#86868b]">
                Link expires
              </p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {OFFER_DURATIONS.map((option) => {
                  const escrowOnly = tradeMode !== 'escrow' && option.seconds > MAX_IN_WALLET_OFFER_DURATION;
                  return (
                  <button
                    key={option.seconds}
                    type="button"
                    disabled={escrowOnly}
                    title={escrowOnly ? '7 days is for Escrow offers' : undefined}
                    onClick={() => onOfferDurationChange(option.seconds)}
                    className={`rounded-full px-2.5 py-1 text-[11px] ${
                      offerDuration === option.seconds
                        ? 'bg-white/15 text-white'
                        : escrowOnly
                          ? 'cursor-not-allowed bg-white/5 text-[#4a4a4e]'
                          : 'bg-white/5 text-[#86868b] hover:text-white'
                    }`}
                  >
                    {option.label}
                  </button>
                  );
                })}
              </div>
              <p className="mt-2 text-center text-[11px] leading-4 text-[#86868b]">
                {tradeMode === 'escrow'
                  ? 'After this, the offer closes and escrow NFTs can be claimed back.'
                  : `After this, accept is off and any attached ${tokenSymbol} returns.`}
              </p>
            </div>
            <button
              onClick={onTrade}
              disabled={
                !canTrade ||
                userEthOver ||
                isTrading ||
                checkingSends ||
                (tradeMode === 'escrow' && !escrowReady) ||
                Boolean(blockedSends?.length && (tradeMode !== 'escrow' || !escrowReady))
              }
              className={`h-12 min-w-[180px] rounded-full px-8 text-[15px] font-medium ${
                canTrade && !userEthOver && !isTrading && !checkingSends && (tradeMode !== 'escrow' || escrowReady) && !(blockedSends?.length && tradeMode !== 'escrow')
                  ? 'bg-[#0071e3] text-white hover:bg-[#0077ed]'
                  : 'glass-pill text-[#6e6e73]'
              }`}
            >
              {isTrading ? 'Creating' : isCountering ? 'Send counter' : 'Make offer'}
            </button>
            <button onClick={onClear} className="text-[13px] text-[#86868b] hover:text-white">
              Clear
            </button>
          </div>
        </Spotlight>
      </div>
    </div>
  );
}

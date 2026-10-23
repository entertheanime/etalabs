'use client';

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import SiteNav from '../components/SiteNav';
import SafeImage from '../components/SafeImage';
import OpenSeaItemButton from '../components/OpenSeaItemButton';
import toast from 'react-hot-toast';
import { getUserTrades, getTimeUntilExpiration, isTradeExpired, expiresAtMs, type NFTItem, type TradeProposal } from '../../services/trade';
import { isEscrowMode, isIncompleteEscrowOffer, tradeModeLabel } from '@/lib/tradeMode';
import { isEscrowTrade } from '@/lib/escrow';
import { expireAndRefundEscrow, listHeldEscrowClaims, readCachedEscrowClaims, rememberEscrowTradeId, explainEscrowError } from '@/services/escrow';
import { isWalletRejected } from '@/lib/tradeErrors';
import { useIsMounted } from '@/app/hooks/useIsMounted';
import { inferTradeNetwork } from '@/lib/tradeNetwork';

type Filter = 'all' | 'inbox' | 'sent' | 'pending' | 'expired' | 'accepted' | 'declined';

function isChainUnknown(trade: TradeProposal) {
  return Boolean(trade.chainStatusUnknown);
}

function isExpiredOffer(trade: TradeProposal) {
  if (isChainUnknown(trade)) return false;
  const status = (trade.status || 'pending').toLowerCase();
  if (status === 'expired') return true;
  return status === 'pending' && isTradeExpired(trade.expiresAt);
}

function isOpenPending(trade: TradeProposal) {
  if (isChainUnknown(trade) || isIncompleteEscrowOffer(trade)) return false;
  return (trade.status || 'pending').toLowerCase() === 'pending' && !isExpiredOffer(trade);
}

function tradeKey(trade: TradeProposal) {
  return `${(trade.tradeContract || '').toLowerCase()}-${trade.blockchainTradeId || trade.id || ''}`;
}

function hiddenActivityKey(wallet: string) {
  return `etaswap-activity-hidden:${wallet.toLowerCase()}`;
}

function readHiddenActivity(wallet: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(hiddenActivityKey(wallet)) || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function writeHiddenActivity(wallet: string, keys: string[]) {
  window.localStorage.setItem(hiddenActivityKey(wallet), JSON.stringify([...new Set(keys)].slice(-400)));
}

function canHideFromActivity(trade: TradeProposal) {
  return !isOpenPending(trade);
}

function shortAddr(value?: string) {
  if (!value) return '—';
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function formatWhen(date: unknown) {
  try {
    let dateObj: Date | null = null;
    const raw = date as { toDate?: () => Date; seconds?: number };
    if (raw?.toDate) dateObj = raw.toDate();
    else if (raw?.seconds) dateObj = new Date(raw.seconds * 1000);
    else if (date instanceof Date) dateObj = date;
    else if (typeof date === 'string') dateObj = new Date(date);
    else if (typeof date === 'number') dateObj = new Date(date > 1e12 ? date : date * 1000);
    if (!dateObj || Number.isNaN(dateObj.getTime())) return '';
    return dateObj.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return 'Unknown';
  }
}

function statusStyle(status?: string) {
  switch ((status || 'pending').toLowerCase()) {
    case 'accepted':
      return 'bg-emerald-500/15 text-emerald-400';
    case 'declined':
    case 'cancelled':
    case 'expired':
    case 'incomplete':
    case 'countered':
      return 'bg-red-500/15 text-red-400';
    case 'unknown':
      return 'bg-white/10 text-[#a1a1a6]';
    default:
      return 'bg-[#ff453a]/15 text-[#ff6b63]';
  }
}

function cashPill(amount?: string, symbol?: string) {
  if (!amount || parseFloat(amount) <= 0 || !symbol) return null;
  return (
    <span className="ml-1 rounded-md bg-[#e8e8ed] px-2 py-1 text-[12px] font-semibold text-[#1d1d1f] dark:bg-[#1c1f2b] dark:text-white">
      {amount} {symbol}
    </span>
  );
}

function NftStrip({
  items,
  eth,
  chog,
  native = 'ETH',
}: {
  items: NFTItem[];
  eth?: string;
  chog?: string;
  native?: string;
}) {
  const extra = Math.max(0, items.length - 5);
  const hasEth = parseFloat(eth || '0') > 0;
  const hasChog = parseFloat(chog || '0') > 0;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.slice(0, 5).map((nft) => (
        <div
          key={`${nft.contract}-${nft.tokenId}`}
          className="relative h-12 w-12 overflow-hidden rounded-md bg-[#e8e8ed] dark:bg-[#10121a]"
          title={nft.name || `#${nft.tokenId}`}
        >
          <SafeImage src={nft.image || '/placeholder.svg'} alt={nft.name || ''} className="h-full w-full object-cover" />
          <OpenSeaItemButton contract={nft.contract} tokenId={nft.tokenId} className="h-4 w-4" />
        </div>
      ))}
      {extra > 0 && (
        <span className="flex h-12 w-12 items-center justify-center rounded-md bg-[#e8e8ed] text-[11px] font-semibold text-[#4b5563] dark:bg-[#1c1f2b] dark:text-[#9aa0b8]">
          +{extra}
        </span>
      )}
      {cashPill(eth, native)}
      {cashPill(chog, 'CHOG')}
      {items.length === 0 && !hasEth && !hasChog && (
        <span className="text-[12px] text-[#6e6e73] dark:text-[#8b91a8]">Nothing</span>
      )}
    </div>
  );
}

function TradeCard({
  trade,
  address,
  onHide,
}: {
  trade: TradeProposal;
  address?: string;
  onHide?: () => void;
}) {
  const [, setTick] = useState(0);
  const expiryMs = expiresAtMs(trade.expiresAt);
  useEffect(() => {
    if (!expiryMs || expiryMs <= Date.now()) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [expiryMs]);
  const you = address?.toLowerCase();
  const incoming = trade.to?.toLowerCase() === you;
  const offerer = trade.from;
  const counterparty = incoming ? trade.from : trade.to;
  const expired = isExpiredOffer(trade);
  const status = isChainUnknown(trade)
    ? 'unknown'
    : expired
      ? 'expired'
      : isIncompleteEscrowOffer(trade)
        ? 'incomplete'
        : trade.counteredWith
          ? 'countered'
          : (trade.status || 'pending').toLowerCase();
  const label = status === 'unknown'
    ? 'Unknown'
    : status === 'incomplete'
    ? "Didn't go through"
    : status === 'countered'
      ? 'Countered'
      : incoming && status === 'pending'
    ? 'Incoming'
    : status.charAt(0).toUpperCase() + status.slice(1);
  const timeLeft = expiryMs && status === 'pending' ? getTimeUntilExpiration(expiryMs) : '';
  const href = `/trade/${encodeURIComponent(
    trade.counteredWith || trade.id || `${trade.tradeContract || ''}-${trade.blockchainTradeId}`
  )}`;
  const escrow = isEscrowMode(trade) || isEscrowTrade(trade);
  const native = inferTradeNetwork(trade) === 'monad' || trade.network === 'monad' ? 'MON' : 'ETH';

  return (
    <Link href={href}>
      <article className={`glass relative overflow-hidden rounded-[22px] p-5 transition hover:bg-black/[0.02] dark:hover:bg-white/[0.07] ${incoming && status === 'pending' ? 'border-[#ff453a]/25' : ''}`}>
        {incoming && status === 'pending' && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-[#ff453a]" />}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold text-[#1d1d1f] dark:text-white">
              {incoming ? `Offer from ${shortAddr(offerer)}` : `Your offer to ${shortAddr(counterparty)}`}
            </p>
            <p className="mt-0.5 text-[12px] text-[#6e6e73] dark:text-[#8b91a8]">
              {status === 'unknown'
                ? 'Could not verify this offer on chain'
                : status === 'incomplete'
                ? incoming
                  ? 'They never finished this'
                  : 'Not sent. Claim your NFTs.'
                : status === 'countered'
                  ? incoming
                    ? 'You sent a counter'
                    : 'They sent a counter'
                : incoming
                  ? 'They sent this to you'
                  : 'You sent this'}
              {' · '}
              {tradeModeLabel(trade)}
              {formatWhen(trade.createdAt) ? ` · ${formatWhen(trade.createdAt)}` : ''}
              {timeLeft ? ` · ${timeLeft} left` : ''}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-1">
              <span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${incoming && status === 'pending' ? 'bg-[#ff3b30]/15 text-[#ff6b63]' : statusStyle(status)}`}>
                {label}
              </span>
              {onHide && canHideFromActivity(trade) && (
                <button
                  type="button"
                  aria-label="Remove from Activity"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onHide();
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-[#86868b] hover:bg-white/10 hover:text-white"
                >
                  ×
                </button>
              )}
            </div>
            {escrow && (
              <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-medium text-[#86868b]">
                Escrow
              </span>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#6e6e73] dark:text-[#8b91a8]">
              {incoming ? 'They offer' : 'You offer'}
            </p>
            <NftStrip items={trade.offer || []} eth={trade.offeredMonad} chog={trade.offeredChog} native={native} />
          </div>
          <div className="hidden h-8 w-8 items-center justify-center rounded-full bg-[#ff453a]/15 text-[#ff6b63] sm:flex">
            ⇄
          </div>
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#6e6e73] dark:text-[#8b91a8]">
              {incoming ? 'They want' : 'You receive'}
            </p>
            <NftStrip items={trade.requested || []} eth={trade.requestedMonad} chog={trade.requestedChog} native={native} />
          </div>
        </div>
      </article>
    </Link>
  );
}

function toClaimRow(row: { blockchainTradeId: string; tradeContract: string; count: number }) {
  return {
    trade: {
      blockchainTradeId: row.blockchainTradeId,
      tradeContract: row.tradeContract,
    } as TradeProposal,
    count: row.count,
  };
}

function TradesPageInner() {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const isMounted = useIsMounted();
  const searchParams = useSearchParams();
  const [myTrades, setMyTrades] = useState<TradeProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [claimable, setClaimable] = useState<{ trade: TradeProposal; count: number }[]>([]);
  const [claiming, setClaiming] = useState(false);
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([]);
  const [filter, setFilter] = useState<Filter>(
    searchParams.get('inbox') === '1'
      ? 'inbox'
      : searchParams.get('sent') === '1'
        ? 'sent'
        : searchParams.get('expired') === '1'
          ? 'expired'
          : 'all'
  );

  useEffect(() => {
    if (!address) {
      setMyTrades([]);
      setHiddenKeys([]);
      setLoading(false);
      return;
    }
    setHiddenKeys(readHiddenActivity(address));
    let cancelled = false;
    let inFlight = false;
    let requestId = 0;
    setLoading(true);
    const load = (silent = false) => {
      if (inFlight) return;
      inFlight = true;
      const request = ++requestId;
      if (!silent) setLoading(true);
      getUserTrades(address)
        .then((userTrades) => {
          if (!cancelled && request === requestId) setMyTrades(userTrades);
        })
        .catch((error) => {
          console.error('Error loading trades:', error);
        })
        .finally(() => {
          if (request === requestId) inFlight = false;
          if (!cancelled && request === requestId) setLoading(false);
        });
    };
    load();
    const timer = window.setInterval(() => load(true), 12000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [address]);

  const loadClaimableRows = useCallback(async (wallet: string) => {
    const rows = await listHeldEscrowClaims(wallet);
    return rows.map(toClaimRow);
  }, []);

  useEffect(() => {
    if (!address) {
      setClaimable([]);
      return;
    }
    const cached = readCachedEscrowClaims(address);
    if (cached.length) setClaimable(cached.map(toClaimRow));
    let cancelled = false;
    let inFlight = false;
    const load = () => {
      if (inFlight) return;
      inFlight = true;
      loadClaimableRows(address)
        .then((rows) => {
          if (!cancelled) setClaimable(rows);
        })
        .catch(() => {
          /* keep cached claimable rows */
        })
        .finally(() => {
          inFlight = false;
        });
    };
    load();
    const timer = window.setInterval(load, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [address, loadClaimableRows]);

  useEffect(() => {
    if (!address) return;
    for (const trade of myTrades) {
      if ((isEscrowMode(trade) || isEscrowTrade(trade)) && trade.blockchainTradeId) {
        rememberEscrowTradeId(address, String(trade.blockchainTradeId));
      }
    }
  }, [address, myTrades]);

  const claimNftCount = claimable.reduce((sum, row) => sum + row.count, 0);
  const visibleTrades = useMemo(() => {
    const hidden = new Set(hiddenKeys);
    return myTrades.filter((trade) => !hidden.has(tradeKey(trade)));
  }, [myTrades, hiddenKeys]);
  const hideTrade = (trade: TradeProposal) => {
    if (!address) return;
    if (!canHideFromActivity(trade)) {
      toast.error('Cancel or finish this offer first.');
      return;
    }
    const next = [...hiddenKeys, tradeKey(trade)];
    setHiddenKeys(next);
    writeHiddenActivity(address, next);
  };

  const filtered = useMemo(() => {
    if (filter === 'all') return visibleTrades;
    if (filter === 'inbox') {
      return visibleTrades.filter(
        (trade) => isOpenPending(trade) && trade.to?.toLowerCase() === address?.toLowerCase()
      );
    }
    if (filter === 'sent') {
      return visibleTrades.filter((trade) => trade.from?.toLowerCase() === address?.toLowerCase());
    }
    if (filter === 'expired') {
      return visibleTrades.filter((trade) => isExpiredOffer(trade));
    }
    if (filter === 'pending') {
      return visibleTrades.filter((trade) => isOpenPending(trade));
    }
    if (filter === 'declined') {
      return visibleTrades.filter(
        (trade) =>
          !isChainUnknown(trade) &&
          ['declined', 'cancelled', 'incomplete'].includes((trade.status || '').toLowerCase())
      );
    }
    return visibleTrades.filter(
      (trade) => !isChainUnknown(trade) && (trade.status || 'pending').toLowerCase() === filter
    );
  }, [filter, visibleTrades, address]);

  const tabCounts = useMemo(() => {
    const you = address?.toLowerCase();
    return {
      inbox: visibleTrades.filter(
        (trade) => isOpenPending(trade) && trade.to?.toLowerCase() === you
      ).length,
      sent: visibleTrades.filter((trade) => trade.from?.toLowerCase() === you).length,
      all: visibleTrades.length,
      pending: visibleTrades.filter((trade) => isOpenPending(trade)).length,
      expired: visibleTrades.filter((trade) => isExpiredOffer(trade)).length,
      accepted: visibleTrades.filter(
        (trade) => !isChainUnknown(trade) && (trade.status || '').toLowerCase() === 'accepted'
      ).length,
      declined: visibleTrades.filter(
        (trade) =>
          !isChainUnknown(trade) &&
          ['declined', 'cancelled', 'incomplete'].includes((trade.status || '').toLowerCase())
      ).length,
    };
  }, [visibleTrades, address]);

  const tabs: { id: Filter; label: string }[] = [
    { id: 'inbox', label: 'Incoming' },
    { id: 'sent', label: 'Sent' },
    { id: 'all', label: 'All' },
    { id: 'pending', label: 'Pending' },
    { id: 'expired', label: 'Expired' },
    { id: 'accepted', label: 'Completed' },
    { id: 'declined', label: 'Declined' },
  ];

  return (
    <div className="min-h-screen glass-page text-[#f5f5f7]">
      <SiteNav />
      <div className="mx-auto max-w-[920px] px-6 py-14">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div className="relative">
            <span aria-hidden="true" className="absolute -left-5 top-1 h-10 w-1 rounded-full bg-[#ff453a]" />
            <h1 className="text-[40px] font-semibold tracking-tight">Activity</h1>
            <p className="mt-2 text-[17px] text-[#86868b]">Incoming offers and trades you sent.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {claimNftCount > 0 && (
              <button
                type="button"
                disabled={claiming}
                onClick={async () => {
                  if (!walletClient) {
                    toast.error('Connect your wallet to claim');
                    return;
                  }
                  try {
                    setClaiming(true);
                    let claimed = 0;
                    const queue = [...claimable];
                    for (const [index, row] of queue.entries()) {
                      toast.loading(
                        `Claiming ${index + 1} of ${queue.length}…`,
                        { id: 'claim-all', duration: 0 }
                      );
                      const hash = await expireAndRefundEscrow(
                        String(row.trade.blockchainTradeId),
                        walletClient,
                        (message) => toast.loading(message, { id: 'claim-all', duration: 0 }),
                        row.trade.tradeContract
                      );
                      if (hash) claimed += row.count;
                    }
                    const leftRows = address ? await loadClaimableRows(address) : [];
                    setClaimable(leftRows);
                    const left = leftRows.reduce((sum, row) => sum + row.count, 0);
                    toast.success(
                      left
                        ? `Claimed ${claimed}. ${left} still in escrow.`
                        : claimed
                          ? `Claimed ${claimed} NFT${claimed === 1 ? '' : 's'}`
                          : 'Nothing was left in escrow',
                      { id: 'claim-all' }
                    );
                    getUserTrades(address as string).then(setMyTrades).catch(() => undefined);
                  } catch (error) {
                    const leftRows = address ? await loadClaimableRows(address) : [];
                    setClaimable(leftRows);
                    const left = leftRows.reduce((sum, row) => sum + row.count, 0);
                    if (isWalletRejected(error) && left > 0) {
                      toast.success(
                        `Got some back. Claim NFTs (${left}) for the rest.`,
                        { id: 'claim-all' }
                      );
                    } else if (isWalletRejected(error) && left === 0) {
                      toast.success('Claimed', { id: 'claim-all' });
                    } else {
                      toast.error(explainEscrowError(error), { id: 'claim-all' });
                    }
                  } finally {
                    setClaiming(false);
                  }
                }}
                className="inline-flex items-center gap-2 rounded-full bg-[#ff453a] px-5 py-2.5 text-[14px] font-medium text-white hover:bg-[#ff5a50] disabled:opacity-70"
              >
                {claiming ? 'Claiming…' : 'Claim NFTs'}
                {!claiming && (
                  <span className="rounded-full bg-white/20 px-1.5 text-[12px] font-semibold">{claimNftCount}</span>
                )}
              </button>
            )}
          </div>
        </div>

        <div className="-mx-6 mb-8 overflow-x-auto px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="glass-pill flex w-max min-w-full gap-1 rounded-full p-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className={`flex shrink-0 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-[13px] ${
                filter === tab.id ? 'bg-[#ff453a]/20 text-[#ff8a83] ring-1 ring-[#ff453a]/25' : 'text-[#86868b] hover:text-white'
              }`}
            >
              {tab.label}
              {tabCounts[tab.id] > 0 && (
                <span
                  className={`rounded-full px-1.5 text-[10px] font-semibold ${
                    tab.id === 'inbox' || tab.id === 'expired'
                      ? 'bg-[#ff3b30] text-white'
                      : 'bg-white/10 text-[#f5f5f7]'
                  }`}
                >
                  {tabCounts[tab.id]}
                </span>
              )}
            </button>
          ))}
          </div>
        </div>

        {!isMounted || (Boolean(address) && loading) ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-[22px] bg-[#1c1c1e]" />
            ))}
          </div>
        ) : !address ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center px-6 text-center">
            <h2 className="text-[28px] font-semibold tracking-tight">Connect to continue.</h2>
            <p className="mt-3 mb-6 max-w-sm text-[15px] text-[#86868b]">
              See trades you created or received.
            </p>
            <ConnectButton label="Connect" showBalance={false} />
          </div>
        ) : filtered.length > 0 ? (
          <div className="space-y-3">
            {filtered.map((trade) => (
              <TradeCard
                key={trade.id || tradeKey(trade)}
                trade={trade}
                address={address}
                onHide={() => hideTrade(trade)}
              />
            ))}
          </div>
        ) : (
          <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
            <h2 className="text-[28px] font-semibold tracking-tight">
              {filter === 'sent'
                ? 'No offers you sent.'
                : filter === 'expired'
                  ? 'No expired offers.'
                  : filter === 'inbox' || filter === 'pending'
                    ? 'No open offers.'
                    : 'No trades yet.'}
            </h2>
            <p className="mt-3 mb-6 max-w-sm text-[15px] text-[#86868b]">
              {filter === 'expired'
                ? 'When a link times out, it shows up here. Open an escrow offer from this list to claim your NFTs.'
                : filter === 'inbox' || filter === 'pending'
                  ? 'The red number only appears while an offer is waiting. Check Completed or Declined for past trades.'
                  : 'Start from the trade board.'}
            </p>
            <Link
              href="/trade"
              className="rounded-full bg-[#ff453a] px-5 py-2.5 text-[14px] font-medium text-white hover:bg-[#ff5a50]"
            >
              Trade
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TradesPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <TradesPageInner />
    </Suspense>
  );
}

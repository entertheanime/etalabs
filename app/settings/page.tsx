'use client';

import { useEffect, useState } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { formatEther } from 'viem';
import toast from 'react-hot-toast';
import SiteNav from '../components/SiteNav';
import SafeImage from '../components/SafeImage';
import OpenSeaItemButton from '../components/OpenSeaItemButton';
import { useIsMounted } from '@/app/hooks/useIsMounted';
import {
  getDeferredChog,
  getDeferredEth,
  readCachedDeferredEth,
  withdrawDeferredChog,
  withdrawDeferredEth,
  writeCachedDeferredEth,
} from '@/services/blockchain';
import {
  expireAndRefundEscrow,
  loadEscrowClaimSnapshot,
  readCachedEscrowClaims,
  withdrawEscrowChog,
  withdrawEscrowEth,
  explainEscrowError,
  type EscrowClaimHint,
} from '@/services/escrow';
import { friendlyTradeError, isWalletRejected } from '@/lib/tradeErrors';
import { useAppNetwork } from '../context/NetworkPrefContext';
import { formatChog } from '@/lib/chog';

const SCAN_STATUS = [
  'Scanning wallet…',
  'Checking escrow…',
  'Looking for leftover NFTs…',
  'Almost done…',
];

function useScanStatus(active: boolean) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!active) {
      setStep(0);
      return;
    }
    const timer = window.setInterval(() => {
      setStep((current) => Math.min(current + 1, SCAN_STATUS.length - 1));
    }, 1600);
    return () => window.clearInterval(timer);
  }, [active]);
  return active ? SCAN_STATUS[step] : '';
}

type NftPreview = { token: string; tokenId: string; name: string; image: string };

function nftKey(nft: { token: string; tokenId: string }) {
  return `${nft.token.toLowerCase()}:${nft.tokenId}`;
}

function waitingNfts(rows: EscrowClaimHint[]) {
  const seen = new Set<string>();
  const list: Array<{ token: string; tokenId: string }> = [];
  for (const row of rows) {
    for (const nft of row.nfts || []) {
      const key = nftKey(nft);
      if (seen.has(key) || !nft.token || !nft.tokenId) continue;
      seen.add(key);
      list.push(nft);
    }
  }
  return list;
}

function EscrowNftTiles({
  nfts,
  previews,
  className = 'mb-5',
}: {
  nfts: Array<{ token: string; tokenId: string }>;
  previews: Record<string, NftPreview>;
  className?: string;
}) {
  if (!nfts.length) return null;
  return (
    <div className={`grid grid-cols-3 gap-2 sm:grid-cols-4 ${className}`}>
      {nfts.map((nft) => {
        const preview = previews[nftKey(nft)];
        return (
          <div
            key={nftKey(nft)}
            className="relative aspect-square overflow-hidden rounded-[16px] bg-[#1c1c1e]"
            title={preview?.name || `#${nft.tokenId}`}
          >
            <SafeImage
              src={preview?.image || '/placeholder.svg'}
              alt={preview?.name || `NFT #${nft.tokenId}`}
              className="h-full w-full object-cover"
            />
            <OpenSeaItemButton contract={nft.token} tokenId={nft.tokenId} className="h-5 w-5" />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
              <p className="truncate text-[11px] text-white">{preview?.name || `#${nft.tokenId}`}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RecoverPanel() {
  const mounted = useIsMounted();
  const network = useAppNetwork();
  const native = network === 'monad' ? 'MON' : 'ETH';
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [claiming, setClaiming] = useState(false);
  const [claimsReady, setClaimsReady] = useState(false);
  const [claims, setClaims] = useState<EscrowClaimHint[]>([]);
  const [ethCredit, setEthCredit] = useState(0n);
  const [chogCredit, setChogCredit] = useState(0n);
  const [deferredEth, setDeferredEth] = useState(0n);
  const [deferredChog, setDeferredChog] = useState(0n);
  const [deferredVerified, setDeferredVerified] = useState(false);
  const [escrowVerified, setEscrowVerified] = useState(false);
  const [previews, setPreviews] = useState<Record<string, NftPreview>>({});

  const loadMine = async (wallet: string) => {
    const { claims: rows, ethCredit: eth, chogCredit: chog, live, reached } = await loadEscrowClaimSnapshot(wallet);
    setClaims(rows);
    setEthCredit(eth);
    setChogCredit(chog);
    setEscrowVerified(live);
    setClaimsReady(true);
    const cached = readCachedDeferredEth(wallet);
    setDeferredEth(cached ?? 0n);
    try {
      const amount = await getDeferredEth(wallet);
      writeCachedDeferredEth(wallet, amount);
      setDeferredEth(amount);
      const chogAmount = await getDeferredChog(wallet);
      setDeferredChog(chogAmount);
      setDeferredVerified(true);
    } catch {
      setDeferredVerified(false);
    }
    if (!reached) {
      throw new Error('Could not reach the chain. Try again.');
    }
  };

  useEffect(() => {
    if (!address) {
      setClaims([]);
      setEthCredit(0n);
      setChogCredit(0n);
      setDeferredEth(0n);
      setDeferredChog(0n);
      setClaimsReady(false);
      setEscrowVerified(false);
      setDeferredVerified(false);
      return;
    }
    setClaimsReady(false);
    setEscrowVerified(false);
    const cached = readCachedDeferredEth(address);
    setDeferredEth(cached ?? 0n);
    setDeferredVerified(false);
    setClaims(readCachedEscrowClaims(address));
    loadMine(address).catch(() => setClaimsReady(true));
  }, [address]);

  useEffect(() => {
    const nfts = waitingNfts(claims);
    if (!nfts.length) {
      setPreviews({});
      return;
    }
    let cancelled = false;
    const items = nfts.map((nft) => `${nft.token}:${nft.tokenId}`).join(',');
    fetch(`/api/nft-preview?items=${encodeURIComponent(items)}`)
      .then((res) => res.json())
      .then((data: { nfts?: NftPreview[] }) => {
        if (cancelled) return;
        const next: Record<string, NftPreview> = {};
        for (const nft of data.nfts || []) next[nftKey(nft)] = nft;
        setPreviews(next);
      })
      .catch(() => {
        if (!cancelled) setPreviews({});
      });
    return () => {
      cancelled = true;
    };
  }, [claims]);

  const nftCount = claims.reduce((sum, row) => sum + row.count, 0);
  const scanning = Boolean(mounted && isConnected && address && !claimsReady);
  const scanStatus = useScanStatus(scanning);

  const claimRows = async (rows: EscrowClaimHint[]) => {
    if (!address) {
      toast.error('Connect your wallet to claim');
      return;
    }
    if (!walletClient) {
      toast.error('Connect your wallet to claim');
      return;
    }
    setClaiming(true);
    try {
      for (const [index, row] of rows.entries()) {
        toast.loading(`Claiming ${index + 1} of ${rows.length}…`, { id: 'recover-claim', duration: 0 });
        await expireAndRefundEscrow(
          String(row.blockchainTradeId),
          walletClient,
          (message) => toast.loading(message, { id: 'recover-claim', duration: 0 }),
          row.tradeContract
        );
      }
      if (ethCredit > 0n) {
        toast.loading(`Claiming ${native}…`, { id: 'recover-claim', duration: 0 });
        await withdrawEscrowEth(walletClient, rows[0]?.tradeContract);
        setEthCredit(0n);
      }
      if (chogCredit > 0n) {
        toast.loading('Claiming CHOG…', { id: 'recover-claim', duration: 0 });
        await withdrawEscrowChog(walletClient, rows[0]?.tradeContract);
        setChogCredit(0n);
      }
      toast.success('Claimed', { id: 'recover-claim' });
      await loadMine(address);
    } catch (err: any) {
      if (isWalletRejected(err)) {
        toast.success('Claimed some. Confirm again for the rest.', { id: 'recover-claim' });
        await loadMine(address);
      } else {
        toast.error(explainEscrowError(err) || friendlyTradeError(err), { id: 'recover-claim' });
      }
    } finally {
      setClaiming(false);
    }
  };

  const claimDeferred = async () => {
    if (!address) {
      toast.error('Connect your wallet to claim');
      return;
    }
    if (!walletClient) {
      toast.error('Connect your wallet to claim');
      return;
    }
    setClaiming(true);
    try {
      const parts = [
        deferredEth > 0n ? native : '',
        deferredChog > 0n ? 'CHOG' : '',
      ].filter(Boolean);
      toast.loading(`Claiming ${parts.join(' and ') || native}…`, { id: 'recover-deferred', duration: 0 });
      if (deferredEth > 0n) {
        await withdrawDeferredEth(walletClient);
        setDeferredEth(0n);
        writeCachedDeferredEth(address, 0n);
      }
      if (deferredChog > 0n) {
        await withdrawDeferredChog(walletClient);
        setDeferredChog(0n);
      }
      toast.success('Claimed', { id: 'recover-deferred' });
      await loadMine(address);
    } catch (err: any) {
      if (isWalletRejected(err)) {
        toast.success(`Confirm again to claim the ${native}${deferredChog > 0n ? ' and CHOG' : ''}.`, { id: 'recover-deferred' });
      } else {
        toast.error(friendlyTradeError(err), { id: 'recover-deferred' });
      }
    } finally {
      setClaiming(false);
    }
  };

  const nfts = waitingNfts(claims);
  const hasEscrow = nftCount > 0 || ethCredit > 0n || chogCredit > 0n;
  const hasDeferred = deferredEth > 0n || deferredChog > 0n;
  const cashWaiting = [
    ethCredit > 0n ? `${formatEther(ethCredit)} ${native}` : '',
    chogCredit > 0n ? `${formatChog(chogCredit)} CHOG` : '',
  ].filter(Boolean).join(' · ');
  const deferredWaiting = [
    deferredEth > 0n ? `${formatEther(deferredEth)} ${native}` : '',
    deferredChog > 0n ? `${formatChog(deferredChog)} CHOG` : '',
  ].filter(Boolean).join(' and ');
  const deferredButton =
    deferredEth > 0n && deferredChog > 0n
      ? `Get ${native} and CHOG back`
      : deferredChog > 0n
        ? 'Get CHOG back'
        : `Get ${native} back`;
  const deferredUnknown = !deferredVerified && !hasDeferred;
  const escrowUnknown = claimsReady && !escrowVerified && !hasEscrow;
  const verifiedEmpty =
    claimsReady && escrowVerified && deferredVerified && !hasEscrow && !hasDeferred;
  const mineReady = Boolean(mounted && isConnected && address);

  return (
    <div className="max-w-xl">
      <h2 className="text-[40px] font-semibold tracking-tight">Claim escrow</h2>
      <p className="mt-2 mb-8 max-w-md text-[17px] leading-relaxed text-[#86868b]">
        If an escrow offer never finished, claim your NFTs here.
      </p>

      {mounted && !isConnected && (
        <p className="text-[14px] text-[#86868b]">Connect your wallet to see leftovers for this wallet only.</p>
      )}

      {mineReady && scanning && (
        <p className="text-[14px] text-[#86868b]">{scanStatus}</p>
      )}

      {mineReady && !scanning && hasEscrow && (
        <div className="mb-10">
          <p className="mb-4 text-[15px] text-[#f5f5f7]">
            {nftCount === 1 ? '1 NFT' : `${nftCount} NFTs`}
            {cashWaiting ? ` · ${cashWaiting}` : ''} waiting in escrow.
          </p>
          <EscrowNftTiles nfts={nfts} previews={previews} />
          {claims.length > 1 && (
            <div className="mb-5 space-y-3">
              {claims.map((row) => (
                <div key={row.blockchainTradeId} className="glass rounded-[18px] px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[13px] text-[#86868b]">
                      Offer #{row.blockchainTradeId} · {row.count === 1 ? '1 NFT' : `${row.count} NFTs`}
                    </p>
                    <button
                      type="button"
                      disabled={claiming}
                      onClick={() => claimRows([row])}
                      className="text-[13px] font-medium text-[#ff6961] disabled:opacity-40"
                    >
                      Claim
                    </button>
                  </div>
                  <EscrowNftTiles nfts={row.nfts || []} previews={previews} className="mt-3" />
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            disabled={claiming}
            onClick={() => claimRows(claims)}
            className="h-12 min-w-[160px] rounded-full bg-[#ff453a] px-8 text-[15px] font-medium text-white disabled:opacity-40"
          >
            {claiming ? 'Claiming…' : 'Claim'}
          </button>
        </div>
      )}

      {mineReady && !scanning && hasDeferred && (
        <div className="mb-10">
          <p className="mb-4 text-[15px] text-[#f5f5f7]">
            {deferredWaiting} left from a trade payout. Claim it here — it does not depend on the offer status.
          </p>
          <button
            type="button"
            disabled={claiming}
            onClick={claimDeferred}
            className="h-12 min-w-[160px] rounded-full bg-[#ff453a] px-8 text-[15px] font-medium text-white disabled:opacity-40"
          >
            {claiming ? 'Claiming…' : deferredButton}
          </button>
        </div>
      )}

      {mineReady && !scanning && verifiedEmpty && (
        <p className="text-[14px] text-[#86868b]">Nothing waiting in escrow for this wallet.</p>
      )}
      {mineReady && !scanning && !hasEscrow && !hasDeferred && (escrowUnknown || deferredUnknown) && (
        <div>
          <p className="mb-4 text-[14px] text-[#86868b]">Could not verify leftovers. Try again.</p>
          <button
            type="button"
            onClick={() => {
              if (!address) return;
              setClaimsReady(false);
              loadMine(address).catch(() => setClaimsReady(true));
            }}
            className="rounded-full bg-[#0071e3] px-5 py-2.5 text-[14px] font-medium text-white hover:bg-[#0077ed]"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div className="min-h-screen glass-page text-[#f5f5f7]">
      <SiteNav />
      <div className="mx-auto max-w-[920px] px-6 py-14 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-16">
        <aside>
          <p className="mb-4 text-[12px] text-[#86868b]">Settings</p>
          <p className="text-left text-[15px] font-medium text-ink">Claim</p>
        </aside>
        <RecoverPanel />
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getTrade, updateTradeStatus, TradeProposal, isLegacyMonadTrade, isTradeExpired, getTimeUntilExpiration } from '@/services/trade';
import { acceptTrade, diagnoseTradeAcceptance, approveNFTsForTradeAcceptance, cancelTrade, declineTrade, expireTrade, getRequiredApprovalsForTrade } from '@/services/blockchain';
import { acceptEscrowTrade, cancelEscrowTrade, depositEscrowSide, expireAndRefundEscrow, getEscrowClaimState, withdrawEscrowEth, withdrawEscrowChog, explainEscrowError } from '@/services/escrow';
import { isEscrowTrade } from '@/lib/escrow';
import ManualApprovalInterface from '@/app/components/ManualApprovalInterface';
import TradeNFTDisplay from '@/app/components/TradeNFTDisplay';
import SiteNav from '@/app/components/SiteNav';
import toast from 'react-hot-toast';
import { useAccount, useWalletClient } from 'wagmi';
import { useIsMounted } from '@/app/hooks/useIsMounted';
import React from 'react';
import { explorerTxUrl } from '@/lib/chain';
import { friendlyTradeError, isWalletRejected } from '@/lib/tradeErrors';
import { prefetchFreshInventory, rememberReceivedTokens, rememberSentTokens } from '@/services/verifiedNFTChecker';
import { inferTradeNetwork } from '@/lib/tradeNetwork';
import ConfirmTradeSides from '@/app/components/ConfirmTradeSides';

function markAcceptedInventory(_wallet: string | undefined, trade: TradeProposal) {
  if (!trade) return;
  const from = String(trade.from || '').toLowerCase();
  const to = String(trade.to || '').toLowerCase();
  const chain = inferTradeNetwork(trade) || trade.network;
  rememberSentTokens(from, trade.offer, chain);
  rememberReceivedTokens(from, trade.requested, chain);
  rememberSentTokens(to, trade.requested, chain);
  rememberReceivedTokens(to, trade.offer, chain);
  prefetchFreshInventory([from, to]);
}

function nativeCash(trade: TradeProposal | null) {
  return inferTradeNetwork(trade) === 'monad' || trade?.network === 'monad' ? 'MON' : 'ETH';
}

function withdrawCashLabel(native: string, withdrawNative: boolean, withdrawChog: boolean, completed = false) {
  const verb = completed ? 'Claim' : 'Withdraw';
  if (withdrawNative && withdrawChog) return `${verb} ${native} and CHOG`;
  if (withdrawChog) return `${verb} CHOG`;
  return `${verb} ${native}`;
}

export default function TradePage() {
  const { id } = useParams();
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [trade, setTrade] = useState<TradeProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);
  const [acceptWait, setAcceptWait] = useState<'wallet' | 'chain' | 'done' | null>(null);
  const [confirmAccept, setConfirmAccept] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [escrowWithdrawEth, setEscrowWithdrawEth] = useState(false);
  const [escrowWithdrawChog, setEscrowWithdrawChog] = useState(false);
  const [escrowNftCount, setEscrowNftCount] = useState(0);
  const [escrowHeldKeys, setEscrowHeldKeys] = useState<string[]>([]);
  const [escrowCreatorMissing, setEscrowCreatorMissing] = useState(0);
  const [showApprovalInterface, setShowApprovalInterface] = useState(false);
  const [requiredApprovals, setRequiredApprovals] = useState<Array<{
    contractAddress: string;
    tokenId: string;
    amount: string;
    standard: 'ERC721' | 'ERC1155';
  }>>([]);
  const [transactionHash, setTransactionHash] = useState<string | null>(null);
  const isMounted = useIsMounted();
  const [, setTick] = useState(0);

  const formatEth = (value?: string) => {
    if (!value) return '0';
    const num = Number(value);
    if (Number.isNaN(num)) return value;
    return num.toLocaleString(undefined, { maximumFractionDigits: 6 });
  };

  const shortAddr = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

  const EthPill = ({ amount, symbol = 'ETH' }: { amount?: string; symbol?: string }) => {
    if (!amount || parseFloat(amount) <= 0) return null;
    return (
      <div className="inline-flex items-center rounded-full bg-white/10 px-3 py-1.5 text-[13px] text-[#f5f5f7]">
        {formatEth(amount)} {symbol}
      </div>
    );
  };
  const CashPills = ({ eth, chog }: { eth?: string; chog?: string }) => (
    <div className="flex flex-wrap gap-2">
      <EthPill amount={eth} symbol={nativeCash(trade)} />
      <EthPill amount={chog} symbol="CHOG" />
    </div>
  );

  // Load trade data
  useEffect(() => {
    const loadTrade = async () => {
      if (!id) return;
      
      try {
        const tradeData = await getTrade(id as string);
        if (!tradeData || isLegacyMonadTrade(tradeData)) {
          setError('This offer is from the old Monad test. It is not live on Robinhood.');
          return;
        }
        setTrade(tradeData);
      } catch (err) {
        console.error('Error loading trade:', err);
        setError(err.message || 'Failed to load trade');
      } finally {
        setIsLoading(false);
      }
    };

    loadTrade();
    const timer = window.setInterval(loadTrade, 12000);
    return () => window.clearInterval(timer);
  }, [id]);

  useEffect(() => {
    if (trade?.status === 'accepted' && (trade.offer?.length || trade.requested?.length)) {
      markAcceptedInventory(address, trade);
    }
  }, [address, trade]);

  useEffect(() => {
    if (!trade?.expiresAt || trade.status === 'expired' || isTradeExpired(trade.expiresAt)) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [trade?.expiresAt, trade?.status]);

  // Check if the connected wallet is the trade recipient or offerer
  const isRecipient = address && trade?.to && address.toLowerCase() === trade.to.toLowerCase();
  const isOfferer = address && trade?.from && address.toLowerCase() === trade.from.toLowerCase();
  const terminalStatus = ['accepted', 'declined', 'cancelled'].includes(
    String(trade?.status || '').toLowerCase()
  );
  const linkExpired = Boolean(
    trade &&
      !terminalStatus &&
      (trade.status === 'expired' || isTradeExpired(trade.expiresAt))
  );
  const chainUnverified = Boolean(trade?.chainStatusUnknown);
  const escrowStatus = trade ? String(trade.status) : '';
  const offerNotReady = Boolean(
    trade &&
      isEscrowTrade(trade) &&
      (escrowStatus === 'incomplete' ||
        (escrowStatus === 'pending' && !linkExpired && escrowCreatorMissing > 0))
  );
  const canAccept = Boolean(
    trade &&
      isRecipient &&
      trade.status === 'pending' &&
      !linkExpired &&
      !offerNotReady &&
      !chainUnverified
  );

  useEffect(() => {
    if (!canAccept) setConfirmAccept(false);
  }, [canAccept]);

  useEffect(() => {
    if (!acceptWait) return;
    const onLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [acceptWait]);

  useEffect(() => {
    if (!trade || !isEscrowTrade(trade) || !address || !trade.blockchainTradeId) {
      setEscrowWithdrawEth(false);
      setEscrowWithdrawChog(false);
      setEscrowNftCount(0);
      setEscrowHeldKeys([]);
      setEscrowCreatorMissing(0);
      return;
    }
    let cancelled = false;
    const loadClaim = () => {
      getEscrowClaimState(String(trade.blockchainTradeId), address, trade.tradeContract)
        .then((claim) => {
          if (cancelled) return;
          setEscrowWithdrawEth(Boolean(claim.canWithdrawEth));
          setEscrowWithdrawChog(Boolean(claim.canWithdrawChog));
          setEscrowNftCount(claim.nftCount || 0);
          setEscrowHeldKeys(claim.heldKeys || []);
          setEscrowCreatorMissing(claim.creatorMissing || 0);
          if (
            claim.onChainStatus &&
            claim.onChainStatus !== 'pending' &&
            trade.status !== claim.onChainStatus
          ) {
            setTrade((prev) => (prev ? { ...prev, status: claim.onChainStatus } : prev));
          }
        })
        .catch(() => {
          /* keep the last good escrow read */
        });
    };
    loadClaim();
    const timer = window.setInterval(loadClaim, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [trade, address]);

  // Handle completion of manual approvals (now mostly unused since we auto-approve)
  const handleApprovalComplete = async () => {
    setShowApprovalInterface(false);
    
    if (!trade?.blockchainTradeId || !walletClient) {
      toast.error('Missing trade information or wallet connection');
      return;
    }

    try {
      setIsExecuting(true);
      setAcceptWait('wallet');
      
      toast.loading('Executing…', {
        id: 'execute-trade',
        duration: 0,
      });
      
      const tradeIdStr = String(trade.blockchainTradeId);
      const txHash = await acceptTrade(tradeIdStr, walletClient, (message) => {
        if (/waiting for confirmation|transaction sent/i.test(message)) setAcceptWait('chain');
        if (/accepted successfully/i.test(message)) setAcceptWait('done');
        toast.loading(message, {
          id: 'execute-trade',
          duration: 0,
        });
      });
      
      console.log('✅ Trade executed successfully after manual approvals!');
      
      // Store transaction hash for explorer link
      setTransactionHash(txHash);
      
      toast.dismiss('execute-trade');
      showTxToast('accepted', txHash);
      markAcceptedInventory(address, trade);
      
      // Update Firebase status to reflect blockchain state and save tx hash
      await updateTradeStatus(id as string, 'accepted', { transactionHash: txHash });
      setTrade(prev => ({ ...prev, status: 'accepted', transactionHash: txHash }));
      
    } catch (err: any) {
      console.error('Error executing trade after approvals:', err);
      const errorMessage = friendlyTradeError(err, {
        you: address,
        them: trade?.from,
      });
      toast.error(errorMessage, {
        id: 'execute-trade',
        duration: 6000,
      });
    } finally {
      setIsExecuting(false);
      setAcceptWait(null);
    }
  };

  // Helper to show success toast with explorer link
  const showTxToast = (status: string, tx?: string) => {
    const label =
      status === 'accepted'
        ? 'Accepted'
        : status === 'cancelled'
          ? 'Cancelled'
          : status === 'declined'
            ? 'Declined'
            : 'Sent';
    toast.custom(
      (t) => (
        <div className="glass flex max-w-[361px] items-start gap-3 rounded-[22px] px-3.5 py-3 text-[13px] leading-[1.35] text-[#f5f5f7]">
          <span>{label}</span>
          {tx && (
            <a
              href={explorerTxUrl(tx || trade?.transactionHash || '')}
              target="_blank"
              rel="noopener noreferrer"
              className="max-w-[120px] truncate text-[12px] text-[#9aa0ff]"
            >
              {tx.slice(0, 10)}…
            </a>
          )}
          <button
            type="button"
            onClick={() => toast.dismiss(t.id)}
            className="text-[#86868b]"
          >
            ×
          </button>
        </div>
      ),
      { duration: 8000, position: 'top-center' }
    );
  };

  const executeAccept = async () => {
    if (!canAccept) {
      setConfirmAccept(false);
      toast.error('This offer is not open to accept.');
      return;
    }
    if (!trade?.blockchainTradeId || !walletClient) {
      toast.error('Please connect your wallet first');
      return;
    }
    if (trade.status === 'expired' || isTradeExpired(trade.expiresAt)) {
      toast.error('This link expired. The offer is closed.');
      return;
    }
    setConfirmAccept(false);
    try {
      setIsExecuting(true);
      setIsAccepting(true);
      setAcceptWait('wallet');
      toast.loading(
        isEscrowTrade(trade)
          ? 'Deposit your NFTs, then confirm accept'
          : 'Approve in your EVM wallet, then confirm the trade',
        {
        id: 'accept-trade',
        duration: 0,
      });

      let txHash: string;
      if (isEscrowTrade(trade)) {
        txHash = await acceptEscrowTrade(
          String(trade.blockchainTradeId),
          walletClient,
          (message) => {
            if (/waiting for confirmation|transaction sent|confirming/i.test(message)) setAcceptWait('chain');
            if (/accepted|complete|done/i.test(message)) setAcceptWait('done');
            toast.loading(message, { id: 'accept-trade', duration: 0 });
          },
          trade.tradeContract
        );
      } else {
      const diagnosis = await diagnoseTradeAcceptance(
        String(trade.blockchainTradeId),
        walletClient,
        trade.tradeContract
      );
      const missingNft = diagnosis.issues.find((issue) =>
        /wallet anymore|isn’t in|isn't in|NFT_NOT_IN/i.test(issue)
      );
      if (missingNft) {
        throw new Error(missingNft);
      }
      const blocking = diagnosis.issues.find((issue) =>
        /not the counterparty|already been accepted|cancelled|expired|declined|does not exist|enough ETH|Diagnostic error/i.test(
          issue
        )
      );
      if (blocking) {
        throw new Error(blocking);
      }

      txHash = await acceptTrade(
        trade.blockchainTradeId,
        walletClient,
        (message) => {
          if (/waiting for confirmation|transaction sent/i.test(message)) setAcceptWait('chain');
          if (/accepted successfully/i.test(message)) setAcceptWait('done');
          toast.loading(message, {
            id: 'accept-trade',
            duration: 0,
          });
        },
        trade.tradeContract
      );
      }
      setTransactionHash(txHash);
      markAcceptedInventory(address, trade);

      toast.success('Accepted', {
        id: 'accept-trade',
        duration: 4000,
      });

      await updateTradeStatus(id as string, 'accepted', {
        acceptedBy: address,
        acceptedAt: new Date(),
        transactionHash: txHash,
      });

      setTrade((prev) => ({ ...prev, status: 'accepted', transactionHash: txHash }));
    } catch (err: any) {
      console.error('Error accepting trade:', err);
      toast.error(
        friendlyTradeError(err, {
          you: address,
          them: trade.from,
        }),
        {
          id: 'accept-trade',
          duration: 6000,
        }
      );
    } finally {
      setIsExecuting(false);
      setIsAccepting(false);
      setAcceptWait(null);
    }
  };

  if (!isMounted) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen glass-page text-[#f5f5f7]">
        <SiteNav />
        <div className="mx-auto max-w-[1180px] px-6 py-16">
          <div className="h-8 w-40 animate-pulse rounded-full bg-white/10" />
          <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="h-72 animate-pulse rounded-[28px] glass" />
            <div className="h-72 animate-pulse rounded-[28px] glass" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !trade) {
    return (
      <div className="min-h-screen glass-page text-[#f5f5f7]">
        <SiteNav />
        <div className="mx-auto max-w-[640px] px-6 py-24 text-center">
          <p className="text-[12px] uppercase tracking-[0.18em] text-[#86868b]">etatrade</p>
          <h1 className="mt-3 text-[28px] font-semibold tracking-tight">Trade not found</h1>
          <p className="mt-3 text-[15px] text-[#a1a1a6]">{error || 'This offer does not exist.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen glass-page text-[#f5f5f7]">
      <SiteNav />
      <div className="mx-auto max-w-[1180px] px-6 py-10">
        <p className="text-[12px] uppercase tracking-[0.18em] text-[#86868b]">Offer</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">Trade</h1>
            <p className="mt-2 max-w-md text-[13px] leading-5 text-[#86868b]">
              {chainUnverified
                ? 'Cannot confirm this offer on-chain right now. Accept is off until the network responds.'
                : offerNotReady
                ? isOfferer
                  ? `This offer didn’t go through. Send the rest of your NFTs, or cancel to get ${nativeCash(trade)} back.`
                  : 'This offer isn’t ready to accept.'
                : linkExpired
                  ? `This offer expired. Close it to get any ${nativeCash(trade)} back.`
                  : trade.status === 'pending'
                    ? 'Waiting for them to accept.'
                    : trade.status === 'accepted'
                      ? 'Done.'
                      : trade.status === 'cancelled'
                        ? isRecipient
                          ? 'They cancelled this offer. It is closed.'
                          : 'You cancelled this offer. It is closed.'
                      : trade.counteredWith
                        ? 'This one closed. They sent a new offer.'
                        : 'This offer is closed.'}
            </p>
            <div className="mt-2 flex items-center gap-2 text-[13px] text-[#a1a1a6]">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  linkExpired
                    ? 'bg-[#ff453a]'
                    : trade.status === 'pending'
                    ? 'bg-[#ffd60a]'
                    : trade.status === 'accepted'
                      ? 'bg-[#30d158]'
                      : 'bg-[#ff453a]'
                }`}
              />
              {offerNotReady
                ? "Didn't go through"
                : linkExpired
                ? 'Expired'
                : trade.status === 'pending'
                ? 'Awaiting response'
                : trade.status === 'accepted'
                  ? 'Completed'
                  : trade.status === 'cancelled'
                    ? 'Cancelled'
                    : 'Declined'}
              {trade.expiresAt && trade.status === 'pending' && !linkExpired && (
                <span className="text-[#86868b]">Closes in {getTimeUntilExpiration(trade.expiresAt)}</span>
              )}
              {trade.counteredWith && (
                <button
                  type="button"
                  onClick={() => router.push(`/trade/${trade.counteredWith}`)}
                  className="text-[#9aa0ff]"
                >
                  Open new offer
                </button>
              )}
              <span className="text-[#86868b]">
                {id}
              </span>
            </div>
          </div>
        </div>

        {trade.message && trade.message.trim() && (
          <div className="glass mt-6 rounded-[22px] px-5 py-4 text-[15px] leading-6 text-[#f5f5f7]">
            {trade.message}
          </div>
        )}

        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
          <TradeNFTDisplay
            nfts={trade.offer}
            title={
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(trade.from);
                  toast.success('Copied');
                }}
              >
                From {shortAddr(trade.from)}
              </button>
            }
            monadAmount={<CashPills eth={trade.offeredMonad} chog={trade.offeredChog} />}
            inEscrowKeys={escrowHeldKeys}
          />
          <TradeNFTDisplay
            nfts={trade.requested}
            title={
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(trade.to);
                  toast.success('Copied');
                }}
              >
                To {shortAddr(trade.to)}
              </button>
            }
            monadAmount={<CashPills eth={trade.requestedMonad} chog={trade.requestedChog} />}
            inEscrowKeys={escrowHeldKeys}
          />
        </div>

        <p className="mt-4 text-center text-[12px] text-[#86868b]">
          Avoid fakes. Click the OpenSea logo and check the NFT before you trade.
        </p>

        {isEscrowTrade(trade) &&
          (isOfferer || isRecipient) &&
          escrowNftCount > 0 &&
          !isAccepting &&
          !isExecuting &&
          !confirmAccept &&
          (offerNotReady ||
            linkExpired ||
            trade.status === 'cancelled' ||
            trade.status === 'declined' ||
            trade.status === 'expired' ||
            trade.status === 'incomplete') && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              disabled={isExecuting || !walletClient}
              onClick={async () => {
                if (!trade.blockchainTradeId || !walletClient) return;
                try {
                  setIsExecuting(true);
                  toast.loading('Claiming…', { id: 'escrow-claim', duration: 0 });
                  const stillOpen = trade.status === 'pending' && !linkExpired;
                  const hash = stillOpen
                    ? await cancelEscrowTrade(
                        String(trade.blockchainTradeId),
                        walletClient,
                        (message) => toast.loading(message, { id: 'escrow-claim', duration: 0 }),
                        trade.tradeContract
                      )
                    : await expireAndRefundEscrow(
                        String(trade.blockchainTradeId),
                        walletClient,
                        (message) => toast.loading(message, { id: 'escrow-claim', duration: 0 }),
                        trade.tradeContract
                      );
                  if (hash) setTransactionHash(hash);
                  const leftover = await getEscrowClaimState(
                    String(trade.blockchainTradeId),
                    address as string,
                    trade.tradeContract
                  );
                  setEscrowNftCount(leftover.nftCount || 0);
                  setEscrowHeldKeys(leftover.heldKeys || []);
                  toast.success(leftover.nftCount ? 'Claimed. Confirm again for the rest.' : 'Claimed', {
                    id: 'escrow-claim',
                  });
                  if (stillOpen) {
                    await updateTradeStatus(id as string, isOfferer ? 'cancelled' : 'declined', {
                      transactionHash: hash,
                    });
                    setTrade((prev) =>
                      prev
                        ? { ...prev, status: isOfferer ? 'cancelled' : 'declined', transactionHash: hash }
                        : prev
                    );
                  }
                } catch (err: any) {
                  try {
                    const leftover = await getEscrowClaimState(
                      String(trade.blockchainTradeId),
                      address as string,
                      trade.tradeContract
                    );
                      setEscrowNftCount(leftover.nftCount || 0);
                      setEscrowHeldKeys(leftover.heldKeys || []);
                    if (isWalletRejected(err) && leftover.nftCount > 0) {
                      toast.success('Claimed some. Confirm again for the rest.', { id: 'escrow-claim' });
                    } else {
                      toast.error(explainEscrowError(err), { id: 'escrow-claim' });
                    }
                  } catch {
                    toast.error(explainEscrowError(err), { id: 'escrow-claim' });
                  }
                } finally {
                  setIsExecuting(false);
                }
              }}
              className="h-12 min-w-[160px] rounded-full bg-[#ff453a] px-8 text-[15px] font-medium text-white disabled:opacity-40"
            >
              Claim
            </button>
          </div>
        )}

        {trade.status === 'pending' && !linkExpired && !offerNotReady && !chainUnverified && isRecipient && (
          <div className="flex flex-col sm:flex-row gap-4 mt-8 justify-center items-center">
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <button
                  onClick={() => {
                    if (!trade?.blockchainTradeId || !walletClient) {
                      toast.error('Please connect your wallet first');
                      return;
                    }
                    setConfirmAccept(true);
                  }}
                  disabled={isExecuting || !isConnected}
                  className={`h-12 min-w-[160px] rounded-full px-8 text-[15px] font-medium text-white ${
                    isExecuting ? 'bg-[#30d158]/40' : 'bg-[#30d158]'
                  }`}
                >
                  {isAccepting ? (
                    <span className="inline-flex items-center justify-center gap-2">
                      <span
                        aria-hidden="true"
                        className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
                      />
                      Accepting…
                    </span>
                  ) : (
                    'Accept'
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => router.push(`/trade?counter=${encodeURIComponent(String(id))}`)}
                  disabled={isExecuting || !isConnected}
                  className="h-12 min-w-[160px] rounded-full bg-white/10 px-8 text-[15px] font-medium text-[#f5f5f7]"
                >
                  Change offer
                </button>
                <button
                  onClick={async () => {
                    if (!trade?.blockchainTradeId || !walletClient) {
                      toast.error('Please connect your wallet first');
                      return;
                    }

                    try {
                      setIsExecuting(true);
                      setIsDeclining(true);

                      toast.loading('Declining trade...', {
                        id: 'decline-trade',
                        duration: 0,
                      });

                      const txHash = isEscrowTrade(trade)
                        ? await cancelEscrowTrade(
                            String(trade.blockchainTradeId),
                            walletClient,
                            (message) => toast.loading(message, { id: 'decline-trade', duration: 0 }),
                            trade.tradeContract
                          )
                        : await declineTrade(
                        trade.blockchainTradeId,
                        walletClient,
                        trade.tradeContract
                      );
                      setTransactionHash(txHash);

                      toast.success('Declined', {
                        id: 'decline-trade',
                        duration: 4000,
                      });

                      await updateTradeStatus(id as string, 'declined', {
                        declinedBy: address,
                        declinedAt: new Date(),
                        transactionHash: txHash
                      });

                      setTrade(prev => ({ ...prev, status: 'declined', transactionHash: txHash }));

                    } catch (err) {
                      console.error('Error declining trade:', err);
                      toast.error(err.message || 'Failed to decline trade', {
                        id: 'decline-trade',
                        duration: 6000,
                      });
                    } finally {
                      setIsExecuting(false);
                      setIsDeclining(false);
                    }
                  }}
                  disabled={isExecuting || !isConnected}
                  className={`h-12 min-w-[160px] rounded-full bg-white/10 px-8 text-[15px] font-medium text-[#f5f5f7] ${
                    isExecuting ? 'opacity-40' : ''
                  }`}
                >
                  {isDeclining ? 'Declining...' : 'Decline'}
                </button>
            </div>
          </div>
        )}

        {isOfferer &&
          isEscrowTrade(trade) &&
          escrowCreatorMissing > 0 &&
          !linkExpired &&
          !['accepted', 'declined', 'cancelled'].includes(String(trade.status || '')) && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              disabled={isExecuting || !walletClient}
              onClick={async () => {
                if (!trade.blockchainTradeId || !walletClient) return;
                try {
                  setIsExecuting(true);
                  toast.loading('Sending NFTs into escrow…', { id: 'escrow-deposit', duration: 0 });
                  await depositEscrowSide(
                    String(trade.blockchainTradeId),
                    0,
                    walletClient,
                    (message) => toast.loading(message, { id: 'escrow-deposit', duration: 0 }),
                    trade.tradeContract
                  );
                  const leftover = await getEscrowClaimState(
                    String(trade.blockchainTradeId),
                    address as string,
                    trade.tradeContract
                  );
                  setEscrowCreatorMissing(leftover.creatorMissing || 0);
                  setEscrowNftCount(leftover.nftCount || 0);
                  setEscrowHeldKeys(leftover.heldKeys || []);
                  if ((leftover.creatorMissing || 0) === 0) {
                    await updateTradeStatus(id as string, 'pending');
                    setTrade((prev) => (prev ? { ...prev, status: 'pending' } : prev));
                    toast.success('NFTs are in escrow. They can accept now.', { id: 'escrow-deposit' });
                  } else {
                    toast.success('Sent some. Confirm again for the rest.', { id: 'escrow-deposit' });
                  }
                } catch (err: any) {
                  toast.error(explainEscrowError(err) || friendlyTradeError(err), { id: 'escrow-deposit' });
                } finally {
                  setIsExecuting(false);
                }
              }}
              className="h-12 min-w-[160px] rounded-full bg-[#0071e3] px-8 text-[15px] font-medium text-white disabled:opacity-40"
            >
              Send remaining NFTs
            </button>
          </div>
        )}

        {isOfferer &&
          !linkExpired &&
          (trade.status === 'pending' || trade.status === 'incomplete' || offerNotReady) && (
          <div className="mt-6 flex justify-center">
                <button
                  onClick={async () => {
                    if (!trade?.blockchainTradeId || !walletClient) {
                      toast.error('Please connect your wallet first');
                      return;
                    }

                    try {
                      setIsExecuting(true);
                      setIsCancelling(true);

                      toast.loading('Cancelling trade...', {
                        id: 'cancel-trade',
                        duration: 0,
                      });

                      const txHash = isEscrowTrade(trade)
                        ? await cancelEscrowTrade(
                            String(trade.blockchainTradeId),
                            walletClient,
                            (message) => toast.loading(message, { id: 'cancel-trade', duration: 0 }),
                            trade.tradeContract
                          )
                        : await cancelTrade(
                        trade.blockchainTradeId,
                        walletClient,
                        trade.tradeContract
                      );
                      setTransactionHash(txHash);

                      toast.success('Cancelled', {
                        id: 'cancel-trade',
                        duration: 4000,
                      });

                      await updateTradeStatus(id as string, 'cancelled', {
                        cancelledBy: address,
                        cancelledAt: new Date(),
                        transactionHash: txHash
                      });

                      setTrade(prev => ({ ...prev, status: 'cancelled', transactionHash: txHash }));

                    } catch (err) {
                      console.error('Error cancelling trade:', err);
                      toast.error(err.message || 'Failed to cancel trade', {
                        id: 'cancel-trade',
                        duration: 6000,
                      });
                    } finally {
                      setIsExecuting(false);
                      setIsCancelling(false);
                    }
                  }}
                  disabled={isExecuting || !isConnected}
                  className={`h-12 min-w-[160px] rounded-full bg-[#ff453a] px-8 text-[15px] font-medium text-white ${
                    isExecuting ? 'opacity-40' : ''
                  }`}
                >
                  {isCancelling ? 'Cancelling...' : offerNotReady ? `Cancel & get ${nativeCash(trade)} back` : 'Cancel'}
                </button>
          </div>
        )}

        {linkExpired && (isOfferer || isRecipient) && trade.status !== 'accepted' && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              disabled={isExecuting || !walletClient}
              onClick={async () => {
                if (!trade.blockchainTradeId || !walletClient) return;
                try {
                  setIsExecuting(true);
                  toast.loading('Closing the expired offer…', { id: 'expire-trade', duration: 0 });
                  const hash = isEscrowTrade(trade)
                    ? await cancelEscrowTrade(
                        String(trade.blockchainTradeId),
                        walletClient,
                        (message) => toast.loading(message, { id: 'expire-trade', duration: 0 }),
                        trade.tradeContract
                      )
                    : await expireTrade(
                        String(trade.blockchainTradeId),
                        walletClient,
                        trade.tradeContract
                      );
                  if (hash) setTransactionHash(hash);
                  await updateTradeStatus(id as string, 'expired', { transactionHash: hash });
                  setTrade((prev) => (prev ? { ...prev, status: 'expired', transactionHash: hash } : prev));
                  toast.success(
                    nativeCash(trade) === 'MON'
                      ? 'Closed. Any MON or CHOG is back or waiting in Settings.'
                      : 'Closed. Any ETH is back or waiting in Settings.',
                    { id: 'expire-trade' }
                  );
                } catch (err: any) {
                  toast.error(friendlyTradeError(err) || err?.message || 'Could not close this offer', {
                    id: 'expire-trade',
                  });
                } finally {
                  setIsExecuting(false);
                }
              }}
              className="h-12 min-w-[160px] rounded-full bg-[#ff453a] px-8 text-[15px] font-medium text-white disabled:opacity-40"
            >
              Get {nativeCash(trade)} back
            </button>
          </div>
        )}

        {isEscrowTrade(trade) && trade.status !== 'accepted' && (escrowWithdrawEth || escrowWithdrawChog) && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              disabled={isExecuting || !walletClient}
              onClick={async () => {
                if (!walletClient) return;
                const native = nativeCash(trade);
                const label = withdrawCashLabel(native, escrowWithdrawEth, escrowWithdrawChog);
                try {
                  setIsExecuting(true);
                  toast.loading(`${label} from escrow…`, { id: 'escrow-eth', duration: 0 });
                  let hash = '';
                  if (escrowWithdrawEth) {
                    hash = await withdrawEscrowEth(walletClient, trade.tradeContract);
                  }
                  if (escrowWithdrawChog) {
                    hash = await withdrawEscrowChog(walletClient, trade.tradeContract) || hash;
                  }
                  if (hash) setTransactionHash(hash);
                  setEscrowWithdrawEth(false);
                  setEscrowWithdrawChog(false);
                  toast.success(`${label.replace('Withdraw ', '')} withdrawn`, { id: 'escrow-eth' });
                } catch (err: any) {
                  toast.error(friendlyTradeError(err), { id: 'escrow-eth' });
                } finally {
                  setIsExecuting(false);
                }
              }}
              className="h-12 rounded-full bg-white/10 px-8 text-[15px] font-medium text-[#f5f5f7]"
            >
              {withdrawCashLabel(nativeCash(trade), escrowWithdrawEth, escrowWithdrawChog)}
            </button>
          </div>
        )}

        {/* Transaction Link */}
        { (transactionHash || trade?.transactionHash) && (
          <a
            href={explorerTxUrl(transactionHash || trade?.transactionHash || '')}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-8 block break-all text-[13px] text-[#9aa0ff]"
          >
            {transactionHash || trade?.transactionHash}
          </a>
        )}
      </div>

      {acceptWait && (
        <div className="fixed inset-0 z-[100001] flex items-end justify-center bg-black/65 p-4 sm:items-center">
          <div className="w-full max-w-[360px] overflow-hidden rounded-[28px] border border-white/12 bg-[#1c1c1e] px-5 pb-6 pt-7 text-center shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
            <div
              aria-hidden="true"
              className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-[#30d158]/25 border-t-[#30d158]"
            />
            <h3 className="mt-4 text-[21px] font-semibold tracking-tight text-[#f5f5f7]">
              {acceptWait === 'wallet'
                ? 'Confirm in your wallet'
                : acceptWait === 'chain'
                  ? 'Please wait'
                  : 'Finishing the swap'}
            </h3>
            <p className="mx-auto mt-2 max-w-[280px] text-[14px] leading-[1.4] text-[#a1a1a6]">
              {acceptWait === 'wallet'
                ? 'Approve in your wallet, then stay on this page. It is loading — not stuck.'
                : acceptWait === 'chain'
                  ? 'Wallet confirmed. The trade is landing on-chain. Don’t close this tab.'
                  : 'Almost done. Don’t close this tab until the NFTs move.'}
            </p>
          </div>
        </div>
      )}

      {confirmAccept && trade && canAccept && (
        <div
          className="fixed inset-0 z-[100000] flex items-end justify-center bg-black/55 p-4 sm:items-center"
          onClick={() => !isExecuting && setConfirmAccept(false)}
        >
          <div
            className="w-full max-w-[340px] overflow-hidden rounded-[28px] border border-black/[0.08] bg-[#ffffff] px-5 pb-5 pt-6 text-center shadow-[0_24px_80px_rgba(0,0,0,0.22)] dark:border-white/12 dark:bg-[#1c1c1e] dark:shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[21px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">You’re trading</h3>
            <p className="mx-auto mt-1.5 max-w-[260px] text-[13px] leading-[1.35] text-[#6e6e73] dark:text-[#a1a1a6]">
              Confirm in your wallet to finish this trade.
            </p>
            <ConfirmTradeSides
              offer={isRecipient ? trade.requested || [] : trade.offer || []}
              receive={isRecipient ? trade.offer || [] : trade.requested || []}
              offerEth={isRecipient ? trade.requestedMonad : trade.offeredMonad}
              receiveEth={isRecipient ? trade.offeredMonad : trade.requestedMonad}
              offerChog={isRecipient ? trade.requestedChog : trade.offeredChog}
              receiveChog={isRecipient ? trade.offeredChog : trade.requestedChog}
              nativeSymbol={trade.network === 'monad' ? 'MON' : 'ETH'}
            />
            <div className="mt-6 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isExecuting}
                onClick={() => setConfirmAccept(false)}
                className="h-[50px] rounded-full bg-black/[0.06] text-[17px] font-medium text-[#1d1d1f] dark:bg-white/10 dark:text-[#f5f5f7]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isExecuting}
                onClick={executeAccept}
                className="h-[50px] rounded-full bg-[#30d158] text-[17px] font-medium text-white"
              >
                {isAccepting ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <span
                      aria-hidden="true"
                      className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
                    />
                    Confirming…
                  </span>
                ) : (
                  'Confirm'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Approval Interface Modal */}
      <ManualApprovalInterface
        requiredApprovals={requiredApprovals}
        onApprovalComplete={handleApprovalComplete}
        isVisible={showApprovalInterface}
      />
    </div>
  );
} 

'use client';

import { useEffect, useState } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import V9Artifact from '@/lib/abis/EtaSwapV9.json';
import { TRADE_CONTRACT_STORAGE_KEY, getTradeContractAddress, STAY_IN_WALLET_TRADE_ADDRESS, LEGACY_ESCROW_TRADE_ADDRESS, PREVIOUS_STAY_IN_WALLET_TRADE_ADDRESS } from '@/lib/contracts';
import { ACTIVE_CHAIN, EXPLORER_URL } from '@/lib/chain';

const ZERO = '0x0000000000000000000000000000000000000000';

export default function PublishContractButton({
  fullWidth = false,
}: {
  fullWidth?: boolean;
}) {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [tradeAddress, setTradeAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const isMainnet = ACTIVE_CHAIN.id === 4663;
  const networkLabel = isMainnet ? 'mainnet' : 'testnet';

  useEffect(() => {
    const saved = window.localStorage.getItem(TRADE_CONTRACT_STORAGE_KEY);
    if (
      saved &&
      (saved.toLowerCase() === LEGACY_ESCROW_TRADE_ADDRESS ||
        saved.toLowerCase() === PREVIOUS_STAY_IN_WALLET_TRADE_ADDRESS)
    ) {
      window.localStorage.setItem(TRADE_CONTRACT_STORAGE_KEY, STAY_IN_WALLET_TRADE_ADDRESS);
    }
    const addr = getTradeContractAddress();
    if (addr && addr !== ZERO) setTradeAddress(addr);
  }, []);

  const publish = async () => {
    if (!walletClient || !publicClient || !address) {
      setStatus('Connect your wallet first.');
      return;
    }
    setBusy(true);
    setStatus(`Confirm the EtaSwap V9 ${networkLabel} deployment in your wallet.`);
    try {
      const hash = await walletClient.deployContract({
        abi: V9Artifact.abi as any,
        bytecode: V9Artifact.bytecode as `0x${string}`,
        args: [],
        account: address,
        chain: ACTIVE_CHAIN as any,
        gas: BigInt(5_000_000),
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const deployed = receipt.contractAddress || '';
      if (!deployed) throw new Error('No contract address');
      window.localStorage.setItem(TRADE_CONTRACT_STORAGE_KEY, deployed);
      setTradeAddress(deployed);
      const { saveSharedTradeContract } = await import('@/lib/sharedTradeContract');
      await saveSharedTradeContract(deployed);
      setStatus(`EtaSwap V9 ${networkLabel} contract published and selected.`);
    } catch (error: any) {
      setStatus(error?.shortMessage || error?.message || 'Publish failed');
    } finally {
      setBusy(false);
    }
  };

  if (tradeAddress && !busy) {
    return (
      <div className={fullWidth ? 'w-full space-y-2' : 'flex items-center gap-2'}>
        <a
          href={`${EXPLORER_URL}/address/${tradeAddress}`}
          target="_blank"
          rel="noreferrer"
          className={
            fullWidth
              ? 'block w-full rounded-full bg-fill px-5 py-3 text-center text-[15px] text-ink'
              : 'rounded-full bg-fill px-3 py-1.5 text-[12px] text-ink'
          }
        >
          EtaSwap V9 {tradeAddress.slice(0, 6)}…{tradeAddress.slice(-4)}
        </a>
        <button
          type="button"
          onClick={publish}
          disabled={busy}
          className="inline-flex h-9 items-center justify-center rounded-full border border-black/[0.08] bg-black/[0.04] px-4 text-[12px] font-medium text-[#1d1d1f] transition hover:bg-black/[0.08] dark:border-white/10 dark:bg-white/[0.08] dark:text-[#f5f5f7] dark:hover:bg-white/[0.14]"
        >
          Publish fresh EtaSwap V9 to {networkLabel}
        </button>
      </div>
    );
  }

  return (
    <div className={fullWidth ? 'w-full' : ''}>
      <button
        type="button"
        disabled={busy}
        onClick={publish}
        className={
          fullWidth
            ? 'w-full rounded-full bg-[#0071e3] px-5 py-3 text-[15px] font-medium text-white disabled:opacity-40'
            : 'rounded-full bg-[#0071e3] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40'
        }
      >
        {busy ? `Publishing EtaSwap V9 to ${networkLabel}…` : `Publish EtaSwap V9 to ${networkLabel}`}
      </button>
      {isMainnet && !busy && (
        <p className="mt-3 rounded-xl border border-[#ff453a]/30 bg-[#ff453a]/10 px-3 py-2 text-[12px] leading-5 text-[#ff6961]">
          Mainnet deployment uses real ETH. Review the contract and wallet transaction before confirming.
        </p>
      )}
      {fullWidth && status && (
        <p className="mt-3 text-[13px] text-[#86868b]">{status}</p>
      )}
    </div>
  );
}

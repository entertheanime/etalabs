'use client';

import { useEffect, useRef, useState } from 'react';
import { createPublicClient, http } from 'viem';
import { useAccount, useWalletClient } from 'wagmi';
import EscrowArtifact from '@/lib/abis/EtaSwapEscrowV1.json';
import { ACTIVE_CHAIN, EXPLORER_URL, RPC_URL } from '@/lib/chain';
import { rememberEscrowAddress } from '@/lib/escrow';
import { saveSharedEscrowContract } from '@/lib/sharedTradeContract';

// Escrow must never overwrite the V9 address: the two trade flows use different ABIs.
const storageKey = `etaswap-escrow-v1:${ACTIVE_CHAIN.id}`;
const client = createPublicClient({ chain: ACTIVE_CHAIN as any, transport: http(RPC_URL) });

export default function PublishEscrowButton() {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [deployed, setDeployed] = useState('');
  const [hash, setHash] = useState<`0x${string}` | undefined>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const inFlight = useRef(false);
  const network = ACTIVE_CHAIN.testnet ? 'testnet' : 'mainnet';

  useEffect(() => {
    setDeployed(localStorage.getItem(storageKey) || '');
    setHash((localStorage.getItem(`${storageKey}:pending`) || undefined) as `0x${string}` | undefined);
  }, []);

  const publish = async (fresh = false) => {
    if (inFlight.current) return;
    if (!walletClient || !address) { setStatus('Connect your deployment wallet first.'); return; }
    inFlight.current = true;
    setBusy(true);
    try {
      if (await walletClient.getChainId() !== ACTIVE_CHAIN.id) {
        throw new Error(`Switch your wallet to ${ACTIVE_CHAIN.name} before deploying.`);
      }
      if (fresh) {
        localStorage.removeItem(`${storageKey}:pending`);
        setHash(undefined);
      }
      let transaction = fresh ? undefined : hash;
      if (!transaction) {
        setStatus(`Confirm the escrow ${network} deployment in your wallet.`);
        transaction = await walletClient.deployContract({
          abi: EscrowArtifact.abi,
          bytecode: EscrowArtifact.bytecode as `0x${string}`,
          args: [address],
          account: address,
          chain: ACTIVE_CHAIN as any,
        } as any);
        setHash(transaction);
        localStorage.setItem(`${storageKey}:pending`, transaction);
      }
      setStatus('Deployment submitted. Waiting for confirmation…');
      const receipt = await client.waitForTransactionReceipt({ hash: transaction });
      if (receipt.status !== 'success') {
        localStorage.removeItem(`${storageKey}:pending`);
        setHash(undefined);
        throw new Error('Deployment reverted. No escrow contract was deployed.');
      }
      if (!receipt.contractAddress) throw new Error('Receipt did not contain a contract address. Check the transaction before trying again.');
      const code = await client.getBytecode({ address: receipt.contractAddress });
      if (!code || code === '0x') throw new Error('Contract code could not be verified. Check the transaction before trying again.');
      localStorage.setItem(storageKey, receipt.contractAddress);
      localStorage.removeItem(`${storageKey}:pending`);
      rememberEscrowAddress(receipt.contractAddress);
      await saveSharedEscrowContract(receipt.contractAddress, ACTIVE_CHAIN.id);
      setDeployed(receipt.contractAddress);
      setStatus('Escrow is live. Open Trade, choose Escrow, and send a test offer.');
    } catch (error: any) {
      setStatus(error?.shortMessage || error?.message || 'Escrow deployment failed.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {!deployed && <button type="button" onClick={() => publish(false)} disabled={busy || !address}
        className="w-full rounded-full bg-[#ff453a] px-5 py-3 text-[15px] font-medium text-white transition hover:bg-[#ff5a50] disabled:opacity-40">
        {busy ? 'Confirming escrow deployment…' : hash ? 'Check escrow deployment' : `Publish EtaSwap Escrow V1 to ${network}`}
      </button>}
      {deployed && (
        <a href={`${EXPLORER_URL}/address/${deployed}`} target="_blank" rel="noopener noreferrer"
          className="block break-all rounded-xl bg-fill px-4 py-3 text-[13px] text-ink">
          EtaSwap Escrow V1: {deployed}
        </a>
      )}
      {deployed && (
        <button
          type="button"
          onClick={() => publish(true)}
          disabled={busy || !address}
          className="inline-flex h-9 items-center justify-center rounded-full border border-black/[0.08] bg-black/[0.04] px-4 text-[12px] font-medium text-[#1d1d1f] transition hover:bg-black/[0.08] disabled:opacity-40 dark:border-white/10 dark:bg-white/[0.08] dark:text-[#f5f5f7] dark:hover:bg-white/[0.14]"
        >
          {busy ? 'Publishing EtaSwap Escrow V1…' : `Publish fresh EtaSwap Escrow V1 to ${network}`}
        </button>
      )}
      {hash && <a href={`${EXPLORER_URL}/tx/${hash}`} target="_blank" rel="noopener noreferrer"
        className="block text-[12px] text-[#ff6961]">View deployment transaction ↗</a>}
      <p className="text-[12px] leading-5 text-soft">
        {ACTIVE_CHAIN.testnet ? 'Uses testnet ETH.' : 'Uses real ETH for deployment gas.'} Your connected wallet becomes the escrow owner and fee collector. Initial fees are 0 ETH.
      </p>
      <p role="status" aria-live="polite" className="text-[13px] leading-5 text-[#86868b]">{status}</p>
    </div>
  );
}

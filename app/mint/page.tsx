'use client';

import { useEffect, useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useConnect, usePublicClient, useWalletClient } from 'wagmi';
import SiteNav from '../components/SiteNav';
import { ETA_SWAP_VIDEO_ABI, ETA_SWAP_VIDEO_BYTECODE } from '@/lib/etaSwapVideo';
import { MONAD_MAINNET } from '@/lib/chain';
import { rememberVideoNft, videoNftStorageKey } from '@/lib/contracts';
import { persistNetwork, switchWalletTo } from '@/lib/networkPref';

const PIECES = [
  { name: 'Flame', image: '/images/video/flame.jpg' },
  { name: 'Heart', image: '/images/video/heart.jpg' },
  { name: 'Teddy', image: '/images/video/teddy.jpg' },
] as const;

const CHAIN = MONAD_MAINNET;
const EXPLORER = CHAIN.blockExplorers.default.url;

export default function MintPage() {
  const { address } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [collection, setCollection] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    persistNetwork('monad');
    const saved = window.localStorage.getItem(videoNftStorageKey(CHAIN.id));
    if (saved) setCollection(saved);
  }, []);

  const mint = async (openConnectModal?: () => void) => {
    if (!walletClient || !publicClient || !address) {
      try {
        const connector = connectors.find((item) => item.name === 'MetaMask') || connectors[0];
        if (connector) await connectAsync({ connector });
        else openConnectModal?.();
      } catch {
        openConnectModal?.();
      }
      setStatus('Connect your wallet, then tap Mint all 3 again.');
      return;
    }

    setBusy(true);
    try {
      persistNetwork('monad');
      await switchWalletTo('monad');
      if (walletClient.switchChain) {
        await walletClient.switchChain({ id: CHAIN.id });
      }
      if ((await walletClient.getChainId()) !== CHAIN.id) {
        throw new Error('Switch the wallet to Monad, then mint.');
      }
      setStatus('One confirm mints all 3 on Monad. Approve the deploy in your wallet.');
      const deployHash = await walletClient.deployContract({
        abi: ETA_SWAP_VIDEO_ABI as any,
        bytecode: ETA_SWAP_VIDEO_BYTECODE as `0x${string}`,
        args: [],
        account: address,
        chain: CHAIN as any,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
      const deployed = receipt.contractAddress || '';
      if (!deployed) throw new Error('Deploy succeeded but no contract address came back.');
      rememberVideoNft(deployed, CHAIN.id);
      setCollection(deployed);
      setStatus('Minted Flame, Heart, and Teddy (#1–#3) on Monad. Open Trade to use them. They show as eta.');
    } catch (error: any) {
      setStatus(error?.shortMessage || error?.message || 'Mint failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen glass-page text-[#f5f5f7]">
      <SiteNav />
      <main className="mx-auto max-w-[720px] px-6 py-16">
        <p className="text-[12px] uppercase tracking-[0.18em] text-[#86868b]">Monad · eta mint</p>
        <h1 className="mt-2 text-[32px] font-semibold tracking-tight">Mint</h1>
        <p className="mt-3 text-[15px] leading-6 text-[#a1a1a6]">
          Same fake eta set as Robinhood: Flame, Heart, and Teddy. One confirm deploys the
          collection on Monad and mints all three to you.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {PIECES.map((piece) => (
            <div key={piece.name} className="overflow-hidden rounded-2xl border border-white/10">
              <img src={piece.image} alt={piece.name} className="aspect-square w-full object-cover" />
              <p className="px-3 py-2 text-[14px] font-medium">{piece.name}</p>
            </div>
          ))}
        </div>

        <ConnectButton.Custom>
          {({ openConnectModal }) => (
            <button
              type="button"
              disabled={busy}
              onClick={() => mint(openConnectModal)}
              className="mt-8 w-full rounded-full bg-white px-5 py-3 text-[15px] font-medium text-black disabled:opacity-40"
            >
              {busy ? 'Confirm in your wallet…' : address ? 'Mint all 3 on Monad' : 'Connect & mint all 3'}
            </button>
          )}
        </ConnectButton.Custom>

        {collection && (
          <a
            className="mt-6 block break-all text-[13px] text-[#9aa0ff]"
            href={`${EXPLORER}/address/${collection}`}
            target="_blank"
            rel="noreferrer"
          >
            Collection: {collection}
          </a>
        )}
        {status && <p className="mt-6 text-[13px] leading-6 text-[#86868b]">{status}</p>}
      </main>
    </div>
  );
}

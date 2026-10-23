'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { persistNetwork, chainForNetwork, type AppNetwork } from '@/lib/networkPref';
import { useAppNetwork } from '../context/NetworkPrefContext';

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      className={`h-3 w-3 text-subtle transition-transform ${open ? 'rotate-180' : ''}`}
      aria-hidden="true"
    >
      <path d="M2.2 4.2 6 8l3.8-3.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RobinhoodMark({ className }: { className?: string }) {
  return (
    <span className={`relative inline-flex shrink-0 overflow-hidden rounded-full bg-[#ccff00] ${className || 'h-4 w-4'}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/images/robinhood-chain.png" alt="" className="h-full w-full object-cover" />
    </span>
  );
}

function MonadMark({ className }: { className?: string }) {
  return (
    <span className={`relative inline-flex shrink-0 overflow-hidden ${className || 'h-4 w-4'}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/images/monad-logo.png" alt="" className="h-full w-full object-contain" />
    </span>
  );
}

function EthereumMark({ className }: { className?: string }) {
  return (
    <span className={`relative inline-flex shrink-0 overflow-hidden rounded-full ${className || 'h-4 w-4'}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/images/ethereum-logo.png?v=diamond" alt="" className="h-full w-full object-contain" />
    </span>
  );
}

function InkMark({ className }: { className?: string }) {
  return (
    <span className={`relative inline-flex shrink-0 overflow-hidden rounded-[4px] ${className || 'h-4 w-4'}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/images/ink-logo.svg" alt="" className="h-full w-full object-contain" />
    </span>
  );
}

const NETWORKS = [
  { id: 'robinhood', label: 'Robinhood', Logo: RobinhoodMark, live: true },
  { id: 'monad', label: 'Monad', Logo: MonadMark, live: true },
  { id: 'ethereum', label: 'Ethereum', Logo: EthereumMark, live: false },
  { id: 'ink', label: 'Ink', Logo: InkMark, live: false },
] as const;

export default function NetworkSwitcher({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const currentNetwork = useAppNetwork();
  const { isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const active =
    NETWORKS.find((network) => network.id === currentNetwork) || NETWORKS[0];
  const ActiveLogo = active.Logo;

  async function chooseNetwork(id: (typeof NETWORKS)[number]['id']) {
    const target = NETWORKS.find((network) => network.id === id);
    if (!target?.live || id === active.id || switching) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    setOpen(false);
    try {
      if (isConnected && walletClient?.switchChain) {
        await walletClient.switchChain({ id: chainForNetwork(id as AppNetwork).id });
      }
      persistNetwork(id as AppNetwork);
      window.location.reload();
    } catch (error) {
      setSwitching(false);
      const rejected =
        /user rejected|denied|rejected the request|4001/i.test(
          error instanceof Error ? error.message : String(error)
        );
      if (rejected) return;
      const message = error instanceof Error ? error.message : 'Could not switch network.';
      window.alert(message);
    }
  }

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Network: ${active.label}`}
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex items-center gap-1.5 rounded-full text-ink transition-colors hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40 ${
          open ? 'bg-white/15' : 'bg-fill'
        } ${compact ? 'px-2.5 py-2 text-[12px]' : 'px-2.5 py-1.5 text-[12px]'}`}
      >
        <ActiveLogo className="h-4 w-4" />
        <span className={`font-medium ${compact ? 'max-[380px]:hidden' : ''}`}>{active.label}</span>
        <Caret open={open} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Networks"
          className="absolute right-0 z-[70] mt-2 w-[240px] overflow-hidden rounded-[18px] border border-white/10 bg-[#161618] p-1 shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
        >
          {NETWORKS.map((network) => {
            const Logo = network.Logo;
            const selected = network.id === active.id;
            const live = network.live;
            return (
              <button
                key={network.id}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={!live || switching}
                onClick={() => {
                  void chooseNetwork(network.id);
                }}
                className={`flex w-full items-center gap-2.5 rounded-[14px] px-2.5 py-2 text-left text-[13px] ${
                  live ? 'text-ink hover:bg-white/10' : 'cursor-not-allowed text-ink/55'
                } ${selected ? 'bg-white/[0.06]' : ''}`}
              >
                <Logo className={`h-5 w-5 ${live ? '' : 'opacity-70'}`} />
                <span className="flex-1 font-medium">{network.label}</span>
                {live ? (
                  <span className="rounded-full bg-[#32d74b]/15 px-2 py-0.5 text-[10px] font-medium text-[#32d74b]">
                    Live
                  </span>
                ) : (
                  <span className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] text-subtle">
                    Coming soon
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { Caret };

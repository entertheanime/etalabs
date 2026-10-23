'use client';

import { useEffect, useRef, useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useDisconnect } from 'wagmi';
import { clearWalletSession, revokeAccountPermission } from '@/lib/wallet';
import { Caret } from './NetworkSwitcher';

function shortAddr(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default function WalletButton({ mobile = false }: { mobile?: boolean }) {
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
    <ConnectButton.Custom>
      {({ account, chain, mounted, openConnectModal, openChainModal }) => {
        if (!mounted) return null;

        if (!account) {
          return (
            <button
              type="button"
              onClick={openConnectModal}
              className={`rounded-full bg-[#ff453a] font-medium text-white transition-colors hover:bg-[#e53930] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff453a] ${
                mobile ? 'px-4 py-2 text-[13px]' : 'px-3 py-1.5 text-[12px]'
              }`}
            >
              Connect
            </button>
          );
        }

        return (
          <div ref={menuRef} className="relative">
            {chain?.unsupported && (
              <button
                type="button"
                onClick={openChainModal}
                className="mr-2 rounded-full bg-red-500/20 px-3 py-1.5 text-[12px] text-red-300"
              >
                Wrong network
              </button>
            )}
            <button
              type="button"
              aria-expanded={open}
              aria-haspopup="menu"
              onClick={() => setOpen((value) => !value)}
              className={`inline-flex items-center gap-1.5 rounded-full text-ink transition-colors hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40 ${
                open ? 'bg-white/15' : 'bg-fill'
              } ${mobile ? 'px-3 py-2 text-[12px]' : 'px-3 py-1.5 text-[12px]'}`}
            >
              <span className="font-medium">{shortAddr(account.address)}</span>
              <Caret open={open} />
            </button>
            {open && (
              <div
                role="menu"
                className="absolute right-0 z-[70] mt-2 min-w-[176px] overflow-hidden rounded-[18px] border border-white/10 bg-[#161618] p-1 shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    disconnect();
                    clearWalletSession();
                    openConnectModal();
                  }}
                  className="flex w-full rounded-[14px] px-3 py-2.5 text-left text-[13px] text-ink hover:bg-white/10"
                >
                  Switch wallet
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    void (async () => {
                      await revokeAccountPermission();
                      disconnect();
                      clearWalletSession();
                    })();
                  }}
                  className="flex w-full rounded-[14px] px-3 py-2.5 text-left text-[13px] text-[#ff6961] hover:bg-white/10"
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}

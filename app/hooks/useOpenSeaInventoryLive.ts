'use client';

import { useEffect } from 'react';
import { INVENTORY_CHANGED_EVENT } from '@/services/verifiedNFTChecker';
import { withClientChain } from '@/lib/networkPref';

function validWallet(value: string) {
  const wallet = String(value || '').toLowerCase();
  return wallet.startsWith('0x') && wallet.length === 42 ? wallet : '';
}

export function useOpenSeaInventoryLive(wallets: Array<string | undefined | null>) {
  const key = wallets.map((wallet) => validWallet(wallet || '')).filter(Boolean).sort().join(',');

  useEffect(() => {
    if (!key || typeof window === 'undefined') return;
    const source = new EventSource(withClientChain(`/api/inventory-live?wallets=${encodeURIComponent(key)}`));
    source.onmessage = (event) => {
      let wallet = '';
      try {
        wallet = String(JSON.parse(event.data || '{}')?.wallet || '');
      } catch {
        wallet = '';
      }
      window.dispatchEvent(new CustomEvent(INVENTORY_CHANGED_EVENT, { detail: { wallet } }));
    };
    return () => source.close();
  }, [key]);
}

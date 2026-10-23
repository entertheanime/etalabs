'use client';

import { OPENSEA_CHAIN } from '@/lib/chain';

type OpenSeaItemButtonProps = {
  contract?: string;
  tokenId?: string;
  className?: string;
};

export default function OpenSeaItemButton({
  contract,
  tokenId,
  className = '',
}: OpenSeaItemButtonProps) {
  if (!contract || !tokenId) return null;

  const href = `https://opensea.io/assets/${OPENSEA_CHAIN}/${contract}/${tokenId}`;

  return (
    <button
      type="button"
      aria-label="View this NFT on OpenSea"
      title="View on OpenSea"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        window.open(href, '_blank', 'noopener,noreferrer');
      }}
        className={`absolute bottom-1 right-1 z-10 inline-flex items-center justify-center rounded-full bg-white shadow-lg transition hover:scale-110 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${className}`}
    >
      <img src="/opensea-logo.png" alt="" className="h-[72%] w-[72%] object-contain" />
    </button>
  );
}

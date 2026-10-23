import { NFTItem } from '@/services/trade';
import { getVerifiedNFTName } from '@/app/config/verifiedNFTs';
import { ReactNode } from 'react';
import SafeImage from './SafeImage';
import OpenSeaItemButton from './OpenSeaItemButton';

interface TradeNFTDisplayProps {
  nfts: (NFTItem & { selectedCount?: number })[];
  title: ReactNode;
  monadAmount?: ReactNode;
  isLoading?: boolean;
  inEscrowKeys?: string[];
}

const PLACEHOLDER_IMAGE = '/placeholder.svg';

export default function TradeNFTDisplay({ nfts, title, monadAmount, isLoading = false, inEscrowKeys = [] }: TradeNFTDisplayProps) {

  if (isLoading) {
    return (
      <div className="glass flex h-full min-h-[280px] flex-col rounded-[28px] p-6">
        <div className="mb-4 h-4 w-32 animate-pulse rounded-full bg-white/10" />
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-[18px] glass-slot" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="glass flex h-full min-h-[280px] flex-col rounded-[28px] p-6">
      <h3 className="text-[13px] text-[#86868b]">{title}</h3>
      {nfts.length > 0 && monadAmount && <div className="mt-3">{monadAmount}</div>}

      {nfts.length === 0 ? (
        <div className="flex flex-1 items-center justify-center py-12">
          {monadAmount || <p className="text-[15px] text-[#86868b]">No items</p>}
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-4 gap-2">
          {nfts.map((nft, index) => {
            const collectionName = getVerifiedNFTName(nft.contract);
            const quantity = nft.selectedCount || parseInt(nft.amount || '1', 10);

            return (
              <div key={`${nft.contract}-${nft.tokenId}-${index}`} className="relative aspect-square overflow-hidden rounded-[18px] glass-slot">
                <SafeImage
                  src={nft.image || PLACEHOLDER_IMAGE}
                  alt={nft.name || `NFT #${nft.tokenId}`}
                  className="h-full w-full object-cover"
                />
                <OpenSeaItemButton contract={nft.contract} tokenId={nft.tokenId} className="h-6 w-6" />
                {inEscrowKeys.includes(`${String(nft.contract || '').toLowerCase()}-${nft.tokenId}`) && (
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-[#ff453a] px-1.5 py-0.5 text-[9px] font-semibold text-white">
                    Sent
                  </span>
                )}
                {quantity > 1 && (
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-black/70 px-1.5 text-[10px] text-white">
                    ×{quantity}
                  </span>
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                  <p className="truncate text-[11px] text-white">{nft.name || `#${nft.tokenId}`}</p>
                  {collectionName && (
                    <p className="truncate text-[10px] text-white/70">{collectionName}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

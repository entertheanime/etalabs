import React, { useState } from 'react';
import { Collection, NFT } from '../../types/nft';
import SafeImage from './SafeImage';
import { isVerifiedNFT, getVerifiedNFTName } from '../config/verifiedNFTs';
import VerifiedBadge from './VerifiedBadge';
import { filterVerifiedNFTs } from '../utils/nftFilters';
import { NFTList } from './NFTList';

interface TradePanelProps {
  collections: Collection[];
  nftsByCollection: Record<string, NFT[]>;
  selectedNFTs: NFT[];
  onSelectNFT: (nft: NFT) => void;
  isLoading?: boolean;
  side: 'left' | 'right';
  counterpartyAddress?: string;
  onCounterpartyAddressChange?: (address: string) => void;
  isLoadingCounterparty?: boolean;
  title: string;
  subtitle: string;
  onSelect?: (collection: Collection, tokenId: string) => void;
  selectedTokens?: { [key: string]: number };
  balance?: string;
  icon?: React.ReactNode;
  showBalance?: boolean;
}

const LoadingSkeleton = () => (
  <div className="flex-1 flex flex-col h-full bg-white/80 dark:bg-black/30 backdrop-blur-sm rounded-lg border border-gray-200 dark:border-white/10 transition-colors duration-300">
          <div className="p-4 border-b border-gray-200 dark:border-white/10 transition-colors duration-300">
        <div className="h-6 bg-gray-300 dark:bg-gray-800 rounded w-1/4 animate-pulse transition-colors duration-300"></div>
      </div>
      <div className="p-4">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-300 dark:bg-gray-800 rounded w-1/4 transition-colors duration-300"></div>
          <div className="grid grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="aspect-square bg-gray-300 dark:bg-gray-800 rounded-lg transition-colors duration-300" />
            ))}
          </div>
        </div>
      </div>
  </div>
);

const LoadingSkeletonWithPlaceholders = () => (
  <div className="grid grid-cols-3 gap-4">
    {[...Array(3)].map((_, i) => (
      <div key={i} className="aspect-square bg-gray-800 rounded-lg overflow-hidden animate-pulse">
        <div className="w-full h-full bg-gray-700/50" />
        <div className="absolute bottom-0 left-0 right-0 p-3 bg-gray-800">
          <div className="h-4 bg-gray-700 rounded w-2/3 mb-1" />
          <div className="h-3 bg-gray-700/50 rounded w-1/2" />
        </div>
      </div>
    ))}
  </div>
);

export default function TradePanel({
  collections,
  nftsByCollection,
  selectedNFTs,
  onSelectNFT,
  isLoading,
  side,
  counterpartyAddress,
  onCounterpartyAddressChange,
  isLoadingCounterparty,
  title,
  subtitle,
  onSelect,
  selectedTokens,
  balance,
  icon,
  showBalance = true,
}: TradePanelProps) {
  const PLACEHOLDER_IMAGE = '/placeholder.svg';
  const [isExpanded, setIsExpanded] = useState(true);
  
  // Helper function to clean up NFT name display
  const formatNFTName = (name: string, tokenId: string, collectionId: string) => {
    // Use verified name if available
    if (isVerifiedNFT(collectionId)) {
      // For verified collections, just show the token ID
      return `#${tokenId}`;
    }

    // Remove the tokenId from the end if it exists in the name
    const cleanName = name.replace(new RegExp(`#?${tokenId}$`), '').trim();
    return cleanName || `NFT #${tokenId}`;
  };

  const formatFloorPrice = (price: number) => {
    if (!price) return null;
    // Price is already in the correct format from the API
    return `${Math.round(price).toLocaleString()} Mon`;
  };

  // Filter collections to only include those with verified NFTs
  const verifiedCollections = collections.filter(collection => {
    if (!collection || !collection.id) return false;
    const collectionNFTs = nftsByCollection[collection.id] || [];
    const verifiedNFTs = filterVerifiedNFTs(collectionNFTs);
    return verifiedNFTs.length > 0;
  });

  // Transform collections data to match NFTList interface
  const transformedCollections = verifiedCollections.map(collection => {
    const collectionNFTs = nftsByCollection[collection.id] || [];
    const verifiedNFTs = filterVerifiedNFTs(collectionNFTs);
    
    return {
      collection: {
        id: collection.id,
        name: collection.name,
        primaryContract: collection.id, // Use collection id as contract address
      },
      tokens: verifiedNFTs.map(nft => ({
        tokenId: nft.tokenId,
        name: nft.name || `NFT #${nft.tokenId}`,
        image: nft.image || PLACEHOLDER_IMAGE,
        balance: nft.ownedCount || 1,
      })),
    };
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 border-4 border-gray-800 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
          </div>
          <div className="text-gray-400 font-medium">
            <span className="inline-block animate-pulse">Loading NFTs</span>
            <span className="inline-block animate-[pulse_1s_infinite_200ms]">.</span>
            <span className="inline-block animate-[pulse_1s_infinite_400ms]">.</span>
            <span className="inline-block animate-[pulse_1s_infinite_600ms]">.</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-lg overflow-hidden transition-all duration-300">
      <div 
        className="glass-light px-4 py-3 border-b border-white/20 transition-colors duration-300 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {icon}
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-medium text-gray-900 dark:text-white">
                  {title}
                </span>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {verifiedCollections.length} verified collections
                </span>
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {subtitle}
              </div>
            </div>
          </div>
          
          {balance && (
            <div className="text-right">
              <div className="text-sm text-gray-600 dark:text-gray-400">
                Balance
              </div>
              <div className="text-base font-medium text-gray-900 dark:text-white">
                {balance} Mon
              </div>
            </div>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="p-3">
          <NFTList
            collections={transformedCollections}
            onSelect={onSelect}
            selectedTokens={selectedTokens}
            showBalance={showBalance}
          />
        </div>
      )}
    </div>
  );
} 
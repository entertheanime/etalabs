import type { NFT } from '@/types/nft';
import VerifiedBadge from './VerifiedBadge';
import SafeImage from './SafeImage';
import { isVerifiedNFT } from '../config/verifiedNFTs';

interface NFTListProps {
  collections: {
    collection: {
      id: string;
      name: string;
      primaryContract?: string;
    };
    tokens: Array<{
      tokenId: string;
      name: string;
      image: string;
      balance?: number;
    }>;
  }[];
  onSelect?: (collection: any, tokenId: string) => void;
  selectedTokens?: { [key: string]: number };
  showBalance?: boolean;
}

export function NFTList({ collections, onSelect, selectedTokens = {}, showBalance = true }: NFTListProps) {
  return (
    <div className="space-y-6">
      {collections.map((item) => {
        const collection = item.collection;
        return (
          <div key={collection.id} className="space-y-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {collection.name}
              </h2>
              {isVerifiedNFT(collection.primaryContract || collection.id) && (
                <VerifiedBadge />
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {item.tokens?.map((token) => {
                const isSelected = selectedTokens[`${collection.primaryContract || collection.id}-${token.tokenId}`] > 0;
                
                return (
                  <button
                    key={token.tokenId}
                    onClick={() => onSelect?.(collection, token.tokenId)}
                    className={`
                      relative group bg-gray-800 border border-gray-600 rounded-lg overflow-hidden hover:border-purple-500 transition-colors
                      ${isSelected ? 'border-blue-500 shadow-xl shadow-blue-500/20' : ''}
                    `}
                  >
                    <div className="aspect-square bg-gray-800 flex items-center justify-center">
                      <SafeImage
                        src={token.image || '/placeholder.svg'}
                        alt={token.name || `NFT #${token.tokenId}`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    
                    <div className="absolute bottom-0 left-0 right-0 bg-black/80 backdrop-blur-sm p-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <div className="text-sm font-semibold text-purple-200 truncate">
                            {token.name || `NFT #${token.tokenId}`}
                          </div>
                          <div className="text-xs font-medium text-purple-300 truncate">
                            {collection.name}
                          </div>
                        </div>
                        {showBalance && token.balance && token.balance > 1 && (
                          <div className="bg-purple-900/60 px-2 py-1 rounded-full">
                            <span className="text-xs font-medium text-purple-100">×{token.balance}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
} 
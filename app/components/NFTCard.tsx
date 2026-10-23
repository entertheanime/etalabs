import { isVerifiedNFT, getVerifiedNFTName } from '../config/verifiedNFTs';
import VerifiedBadge from './VerifiedBadge';
import type { NFT } from '../../types/nft';
import SafeImage from './SafeImage';

// In your NFT card component:
export const NFTCard = ({ nft }: { nft: NFT }) => {
  const isVerified = isVerifiedNFT(nft.contractAddress);
  const verifiedName = getVerifiedNFTName(nft.contractAddress);

  return (
    <div className="relative bg-white rounded-lg shadow-md p-4">
      <div className="flex flex-col h-full">
        <div className="relative aspect-square bg-gray-800 rounded-lg overflow-hidden">
          <SafeImage
            src={nft.image || '/placeholder.svg'}
            alt={nft.name || 'NFT'}
            className="w-full h-full object-cover"
          />
          {nft.standard === 'ERC1155' && nft.ownedCount > 1 && (
            <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm px-2 py-1 rounded-full">
              <span className="text-xs font-medium text-white">×{nft.ownedCount}</span>
            </div>
          )}
        </div>
        <div className="flex flex-col flex-grow p-3 bg-purple-100/50 dark:bg-purple-900/20 rounded-b-lg">
          <h3 className="text-sm font-semibold text-purple-900 dark:text-purple-200 mb-1 truncate">
            {nft.name || `NFT #${nft.tokenId}`}
          </h3>
          <p className="text-xs font-medium text-purple-800 dark:text-purple-300 truncate">
            {nft.collectionName || 'Unknown Collection'}
          </p>
        </div>
      </div>
      <div className="mt-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">{nft.name}</h3>
          {isVerified && <VerifiedBadge name={verifiedName} />}
        </div>
        <p className="text-gray-600 text-sm mt-2">{nft.description}</p>
        {nft.floorPrice && (
          <p className="text-gray-800 font-medium mt-2">
            Floor Price: {nft.floorPrice} ETH
          </p>
        )}
      </div>
    </div>
  );
}; 
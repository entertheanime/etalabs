interface VerifiedNFT {
  address: string;
  name: string;
  isERC1155?: boolean;
  mediaOverride?: string;
  logoOverride?: string;
  tokenMediaOverride?: string;
}

export const VERIFIED_NFTS: VerifiedNFT[] = [];

export const isVerifiedNFT = (address?: string): boolean => {
  if (!address) return false;
  if (VERIFIED_NFTS.length === 0) return true;
  return VERIFIED_NFTS.some(nft => nft.address.toLowerCase() === address.toLowerCase());
};

export const getVerifiedNFTName = (address?: string): string | undefined => {
  if (!address) return undefined;
  const nft = VERIFIED_NFTS.find(nft => nft.address.toLowerCase() === address.toLowerCase());
  return nft?.name;
};

export const isERC1155NFT = (address?: string): boolean => {
  if (!address) return false;
  const nft = VERIFIED_NFTS.find(nft => nft.address.toLowerCase() === address.toLowerCase());
  return nft?.isERC1155 === true;
};

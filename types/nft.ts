export interface Collection {
  id: string;
  name: string;
  description?: string;
  image?: string;
  totalSupply: number;
  floorPrice: number;
}

export interface NFT {
  tokenId: string;
  name: string;
  description?: string;
  image?: string;
  collectionId: string;
  contractAddress: string;
  ownership?: {
    tokenCount: string;
    amount?: string;
  };
  floorPrice?: number;
  selectedCount: number;
  standard?: 'ERC721' | 'ERC1155'; // Token standard
  balance?: string; // ERC1155 balance (how many copies owned)
  ownedCount?: number; // Number of copies owned (for display)
  collectionName?: string; // Collection name for display
}

export interface CollectionResponse {
  collection: {
    id: string;
    name: string;
    totalSupply: number;
    floorPrice: number;
    image: string;
  }[];
}

export interface NFTResponse {
  tokens: {
    tokenId: string;
    image: string;
    collectionId: string;
    contractAddress: string;
    ownership?: {
      tokenCount: string;
    };
  }[];
} 
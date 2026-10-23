import { NFT } from './nft';

export interface TradeProposal {
  id?: string;
  status: 'pending' | 'accepted' | 'declined';
  fromAddress: string;
  toAddress: string;
  offeredNFTs: NFT[];
  requestedNFTs: NFT[];
  offeredMONAD: string;
  requestedMONAD: string;
  createdAt: any; // Firebase Timestamp
  updatedAt: any; // Firebase Timestamp
}

export interface TradeData {
  id: string;
  creator: string;
  responder: string;
  creatorAssets: Array<{
    contractAddress: string;
    tokenId: string;
    amount: string;
    standard: number;
  }>;
  responderAssets: Array<{
    contractAddress: string;
    tokenId: string;
    amount: string;
    standard: number;
  }>;
  status: number; // 0: Active, 1: Accepted, 2: Cancelled, 4: Declined
  createdAt: number;
  acceptedAt?: number;
  cancelledAt?: number;
  // Legacy properties for compatibility
  counterparty?: string;
  isActive?: boolean;
  isAccepted?: boolean;
  isCancelled?: boolean;
} 
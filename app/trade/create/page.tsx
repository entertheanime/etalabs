'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount, useWalletClient } from 'wagmi';
import { NFT } from '../../../types/nft';
import { proposeTrade } from '../../../services/trade';
import { createTrade } from '../../../services/blockchain';
import { createEscrowTrade } from '../../../services/escrow';
import { getEscrowAddress } from '@/lib/escrow';
import { classifyOfferItems } from '@/lib/transferPolicy';
import { friendlyTradeError } from '@/lib/tradeErrors';
import toast from 'react-hot-toast';

// Address validation utilities
const isValidEvmAddress = (address: string): boolean => {
  // EVM addresses are 42 characters long, start with 0x, and contain only hex characters
  return /^0x[a-fA-F0-9]{40}$/.test(address);
};

interface NFTSelectionProps {
  nfts: NFT[];
  selectedNFTs: NFT[];
  onSelect: (nft: NFT) => void;
  monadAmount: string;
  onMonadChange: (amount: string) => void;
  title: string;
}

const NFTSelection = ({
  nfts,
  selectedNFTs,
  onSelect,
  monadAmount,
  onMonadChange,
  title
}: NFTSelectionProps) => (
  <div className="bg-gray-800 rounded-lg p-4">
    <h2 className="text-xl font-bold mb-4">{title}</h2>
    
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-400 mb-2">
        Mon Amount
      </label>
      <input
        type="number"
        min="0"
        step="0.000000000000000001"
        value={monadAmount}
        onChange={(e) => onMonadChange(e.target.value)}
        className="w-full bg-gray-700 rounded-lg p-2 text-white"
        placeholder="0.0"
      />
    </div>

    {selectedNFTs.length > 0 && (
      <div className="mb-4">
        <h3 className="text-sm font-medium text-gray-400 mb-2">Added NFTs:</h3>
        <div className="space-y-2">
          {selectedNFTs.map((nft) => (
            <div
              key={nft.tokenId}
              className="flex items-center justify-between bg-gray-700 rounded-lg p-3"
            >
              <div className="flex items-center gap-3">
                <img
                  src={nft.image}
                  alt={nft.name}
                  className="w-12 h-12 rounded-lg object-cover"
                />
                <div>
                  <h4 className="font-medium text-sm">{nft.name}</h4>
                  <p className="text-xs text-gray-400">ID: {nft.tokenId}</p>
                  <p className="text-xs text-gray-500">{nft.contractAddress?.slice(0, 10)}...</p>
                </div>
              </div>
              <button
                onClick={() => onSelect(nft)}
                className="text-red-400 hover:text-red-300 p-1"
                title="Remove NFT"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>
    )}

    {selectedNFTs.length === 0 && (
      <div className="text-center py-8 text-gray-500">
        <svg className="w-12 h-12 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <p className="text-sm">No NFTs added yet</p>
        <p className="text-xs mt-1">Use the form above to add your NFTs</p>
      </div>
    )}
  </div>
);

export default function CreateTradePage() {
  const router = useRouter();
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [loading, setLoading] = useState(false);
  const [offeredNFTs, setOfferedNFTs] = useState<NFT[]>([]);
  const [requestedNFTs, setRequestedNFTs] = useState<NFT[]>([]);
  const [offeredMONAD, setOfferedMONAD] = useState('0');
  const [requestedMONAD, setRequestedMONAD] = useState('0');
  const [toAddress, setToAddress] = useState('');
  const [message, setMessage] = useState('');
  const [tokenIdInput, setTokenIdInput] = useState('');
  const [contractAddressInput, setContractAddressInput] = useState('');
  // Expiry is now fixed at 1 day - no longer configurable

  // Empty arrays - you'll add your real NFTs using the form below
  const myNFTs: NFT[] = [];
  const theirNFTs: NFT[] = [];

  const addRealNFT = () => {
    if (contractAddressInput && tokenIdInput) {
      const realNFT: NFT = {
        tokenId: tokenIdInput,
        contractAddress: contractAddressInput,
        collectionId: contractAddressInput, // Use contract address as collection ID
        image: '/placeholder.svg',
        name: `NFT #${tokenIdInput}`,
        description: 'Manually added NFT',
        selectedCount: 0
      };
      setOfferedNFTs(prev => [...prev, realNFT]);
      setContractAddressInput('');
      setTokenIdInput('');
    }
  };

  const removeNFT = (tokenId: string, isOffered: boolean) => {
    if (isOffered) {
      setOfferedNFTs(prev => prev.filter(nft => nft.tokenId !== tokenId));
    } else {
      setRequestedNFTs(prev => prev.filter(nft => nft.tokenId !== tokenId));
    }
  };

  const handleCreateTrade = async () => {
    if (!address || !walletClient) {
      toast.error('Please connect your wallet to create a trade.', {
        duration: 4000,
        position: 'bottom-right',
        style: {
          background: '#991B1B',
          color: '#ffffff',
          borderRadius: '0.5rem',
        },
      });
      return;
    }

    // Validate EVM address format
    if (!isValidEvmAddress(toAddress)) {
      const errorMessage = 'Please enter a valid wallet address (42 characters, starting with 0x)';
      
      toast.error(errorMessage, {
        duration: 6000,
        position: 'bottom-right',
        style: {
          background: '#991B1B',
          color: '#ffffff',
          borderRadius: '0.5rem',
        },
      });
      return;
    }

    setLoading(true);
    
    try {
      toast.loading('Creating trade offer...', {
        id: 'trade-creation',
        duration: 0,
        position: 'bottom-right',
      });

      toast.loading('Creating offer…', {
        id: 'trade-creation',
        duration: 0,
      });

      const nftItems = [
        ...offeredNFTs.map((nft) => ({ ...nft, owner: address })),
        ...requestedNFTs.map((nft) => ({ ...nft, owner: toAddress })),
      ];
      let useEscrow = false;
      if (nftItems.length) {
        toast.loading('Checking in-wallet vs Escrow…', { id: 'trade-creation', duration: 0 });
        const live = await classifyOfferItems(nftItems, undefined, { fresh: true });
        if (live.unknown.length) {
          throw new Error(
            `Could not confirm ${live.unknown.join(', ')} for an in-wallet send. Use /trade or wait, then try again.`
          );
        }
        if (live.blocked.length) {
          if (!getEscrowAddress()) {
            throw new Error(
              `${live.blocked.join(', ')} ${live.blocked.length === 1 ? 'needs' : 'need'} Escrow. Open /trade or publish Escrow in Settings.`
            );
          }
          useEscrow = true;
        }
      }

      const blockchainTradeParams = {
        counterpartyAddress: toAddress,
        userNFTs: offeredNFTs.map(nft => ({
          contractAddress: nft.contractAddress,
          tokenId: nft.tokenId
        })),
        counterpartyNFTs: requestedNFTs.map(nft => ({
          contractAddress: nft.contractAddress,
          tokenId: nft.tokenId
        })),
        userMonadAmount: offeredMONAD || '0',
        counterpartyMonadAmount: requestedMONAD || '0',
        message: message || '',
        durationSeconds: 60 * 60,
      };

      toast.loading('Confirm in MetaMask…', {
        id: 'trade-creation',
        duration: 0,
      });

      const blockchainTradeId = useEscrow
        ? await createEscrowTrade(
            {
              ...blockchainTradeParams,
              userNFTs: offeredNFTs.map((nft) => ({
                contractAddress: nft.contractAddress,
                tokenId: String(nft.tokenId),
                standard: 0,
              })),
              counterpartyNFTs: requestedNFTs.map((nft) => ({
                contractAddress: nft.contractAddress,
                tokenId: String(nft.tokenId),
                standard: 0,
              })),
            },
            walletClient,
            (msg) => toast.loading(msg, { id: 'trade-creation', duration: 0 })
          )
        : await createTrade(blockchainTradeParams, walletClient);

      // Step 2: Create Firebase record for shareable link
      toast.loading('Creating shareable trade link...', {
        id: 'trade-creation',
        duration: 0,
      });

      const firebaseTradeId = await proposeTrade({
        from: address,
        to: toAddress,
        offer: offeredNFTs.map(nft => ({
          contract: nft.contractAddress,
          tokenId: nft.tokenId,
          image: nft.image,
          name: nft.name
        })),
        requested: requestedNFTs.map(nft => ({
          contract: nft.contractAddress,
          tokenId: nft.tokenId,
          image: nft.image,
          name: nft.name
        })),
        offeredMonad: offeredMONAD,
        requestedMonad: requestedMONAD,
        message: message,
        blockchainTradeId: blockchainTradeId,
        tradeType: useEscrow ? 'escrow-program' : 'stay-in-wallet',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      toast.success('Trade offer created successfully! 🎉', {
        id: 'trade-creation',
        duration: 6000,
        position: 'bottom-right',
        style: {
          background: '#059669',
          color: '#ffffff',
          borderRadius: '0.5rem',
        },
      });

      // Navigate to the trade page
      router.push(`/trade/${firebaseTradeId}`);

    } catch (error) {
      console.error('Error creating trade:', error);
      
      let errorMessage = 'Failed to create trade offer.';
      
      const raw = error instanceof Error ? error.message : '';
      if (raw.includes('User rejected')) {
        errorMessage = 'Transaction was cancelled by user.';
      } else if (raw) {
        errorMessage = friendlyTradeError(error);
      }

      toast.error(errorMessage, {
        id: 'trade-creation',
        duration: 6000,
        position: 'bottom-right',
        style: {
          background: '#991B1B',
          color: '#ffffff',
          borderRadius: '0.5rem',
        },
      });
    } finally {
      setLoading(false);
    }
  };

  if (!address) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-400">Connect Your Wallet</h1>
          <p className="text-gray-500 mt-2">Please connect your wallet to create a trade.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-8">Create Trade</h1>
      
      {/* Testing Notice */}
      <div className="mb-6 bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.728-.833-2.498 0L4.316 15.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <span className="text-yellow-300 font-medium">Testing Mode</span>
        </div>
        <p className="text-yellow-200 text-sm">
          <strong>For testing:</strong> Create Mon-only trades first (e.g., offer 0.1 Mon for 0.2 Mon). 
          To test with NFTs, use the form below to add your actual NFT contract address and token ID that you own.
        </p>
      </div>

      {/* Quick NFT Input Section */}
      <div className="mb-6 bg-gray-800/50 border border-gray-600 rounded-lg p-4">
        <h3 className="text-lg font-medium text-white mb-4">Add Your Real NFT (Optional)</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              NFT Contract Address
            </label>
            <input
              type="text"
              value={contractAddressInput}
              className="w-full bg-gray-700 rounded-lg p-2 text-white text-sm"
              placeholder="0x..."
              onChange={(e) => setContractAddressInput(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              Token ID
            </label>
            <input
              type="text"
              value={tokenIdInput}
              className="w-full bg-gray-700 rounded-lg p-2 text-white text-sm"
              placeholder="1"
              onChange={(e) => setTokenIdInput(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4">
          <button
            type="button"
            onClick={addRealNFT}
            disabled={!contractAddressInput || !tokenIdInput}
            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
          >
            Add NFT to Your Offer
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Enter your real NFT contract address and token ID, then click "Add NFT" to include it in your trade offer.
        </p>
      </div>

      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-400 mb-2">
          Counterparty Address
        </label>
        <input
          type="text"
          value={toAddress}
          onChange={(e) => setToAddress(e.target.value)}
          className={`w-full bg-gray-700 rounded-lg p-2 text-white border ${
            toAddress.length > 10 && !isValidEvmAddress(toAddress)
              ? 'border-red-500 focus:ring-red-500'
              : toAddress && isValidEvmAddress(toAddress)
              ? 'border-green-500 focus:ring-green-500'
              : 'border-gray-600 focus:ring-blue-500'
          } focus:outline-none focus:ring-2`}
          placeholder="Enter EVM address (0x...)"
        />
        {toAddress.length > 10 && !isValidEvmAddress(toAddress) && (
          <div className="mt-2 p-2 bg-red-900/30 border border-red-500/50 rounded text-red-300 text-sm">
            <div className="flex items-center gap-2">
              <span>⚠️</span>
              <span>
                Use a wallet address starting with 0x.
              </span>
            </div>
          </div>
        )}
        {toAddress && isValidEvmAddress(toAddress) && (
          <div className="mt-2 text-green-400 text-sm flex items-center gap-2">
            <span>✅</span>
            <span>Valid EVM address</span>
          </div>
        )}
      </div>

      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-400 mb-2">
          Trade Message (Optional)
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
                      maxLength={50}
          className="w-full bg-gray-700 rounded-lg p-2 text-white resize-none"
          placeholder="Add a message to your trade offer..."
          rows={3}
        />
        <div className="text-xs text-gray-500 mt-1">
          {message.length}/50 characters
        </div>
      </div>

      <div className="mb-6">
        <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-blue-300 font-medium">Trade Expiry: 1 Day</span>
          </div>
          <p className="text-blue-200 text-sm mt-1">
            All trades automatically expire after 24 hours for security.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        <NFTSelection
          nfts={myNFTs}
          selectedNFTs={offeredNFTs}
          onSelect={(nft) => removeNFT(nft.tokenId, true)}
          monadAmount={offeredMONAD}
          onMonadChange={setOfferedMONAD}
          title="Your Offer"
        />
        <NFTSelection
          nfts={theirNFTs}
          selectedNFTs={requestedNFTs}
          onSelect={(nft) => removeNFT(nft.tokenId, false)}
          monadAmount={requestedMONAD}
          onMonadChange={setRequestedMONAD}
          title="Your Request"
        />
      </div>

      <button
        className="w-full bg-blue-600 text-white rounded-lg py-3 font-medium hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
        onClick={handleCreateTrade}
        disabled={loading || !toAddress || !isValidEvmAddress(toAddress) || (!offeredNFTs.length && !parseFloat(offeredMONAD)) || (!requestedNFTs.length && !parseFloat(requestedMONAD))}
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2">
            <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2V6M12 18V22M4.93 4.93L7.76 7.76M16.24 16.24L19.07 19.07M2 12H6M18 12H22M4.93 19.07L7.76 16.24M16.24 7.76L19.07 4.93" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Creating Trade...
          </div>
        ) : (
          'Create Trade Offer'
        )}
      </button>
    </div>
  );
} 
'use client';

import React, { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import EnhancedVerifiedBadge from '../components/EnhancedVerifiedBadge';
import ChainSwitcher from '../components/ChainSwitcher';

interface VerificationResult {
  contractAddress: string;
  tokenId: string;
  isVerified: boolean;
  isBlockchainVerified: boolean;
  isWhitelisted: boolean;
  standard: 'ERC721' | 'ERC1155' | 'UNKNOWN';
  owner: string;
  balance: string;
  name?: string;
  symbol?: string;
  tokenURI?: string;
  error?: string;
  verificationMethod: 'blockchain' | 'whitelist' | 'both' | 'none';
}

interface VerificationStats {
  totalCollections: number;
  whitelistedCollections: number;
  blockchainVerifiedCollections: number;
  totalNFTs: number;
  whitelistedNFTs: number;
  blockchainVerifiedNFTs: number;
  newlyVerifiedNFTs: number;
}

export default function VerifyTestPage() {
  const { address } = useAccount();
  const [isLoading, setIsLoading] = useState(false);
  const [verificationResults, setVerificationResults] = useState<VerificationResult[]>([]);
  const [stats, setStats] = useState<VerificationStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const testVerification = async () => {
    if (!address) {
      setError('Please connect your wallet first');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Get all verified NFTs
      const response = await fetch('/api/verify-nft', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userAddress: address,
          action: 'verify_all'
        })
      });

      if (!response.ok) {
        throw new Error('Failed to verify NFTs');
      }

      const data = await response.json();
      setVerificationResults(data.verifiedNFTs || []);

      // Get stats
      const statsResponse = await fetch('/api/verify-nft', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userAddress: address,
          action: 'get_stats'
        })
      });

      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        setStats(statsData.stats);
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-white">NFT Verification Test</h1>
          <div className="flex items-center gap-4">
            <ChainSwitcher />
            <ConnectButton label="Connect" showBalance={false} />
          </div>
        </div>

        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-white mb-4">
            🔍 Blockchain NFT Verification Test
          </h2>
          <p className="text-zinc-400 text-lg">
            Test the enhanced verification system that checks NFTs on the blockchain
          </p>
        </div>

        {!address ? (
          <div className="text-center">
            <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-6">
              <p className="text-red-300 text-lg">
                Please connect your wallet to test verification
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Test Button */}
            <div className="text-center">
              <button
                onClick={testVerification}
                disabled={isLoading}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-semibold py-3 px-6 rounded-lg transition-colors duration-200"
              >
                {isLoading ? '🔍 Verifying...' : '🔍 Test Blockchain Verification'}
              </button>
            </div>

            {/* Error Display */}
            {error && (
              <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4">
                <p className="text-red-300">{error}</p>
              </div>
            )}

            {/* Stats Display */}
            {stats && (
              <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6">
                <h2 className="text-2xl font-bold text-white mb-4">📊 Verification Statistics</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-blue-500/20 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-blue-300">{stats.totalCollections}</div>
                    <div className="text-sm text-gray-300">Total Collections</div>
                  </div>
                  <div className="bg-green-500/20 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-green-300">{stats.whitelistedCollections}</div>
                    <div className="text-sm text-gray-300">Whitelisted Collections</div>
                  </div>
                  <div className="bg-purple-500/20 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-purple-300">{stats.blockchainVerifiedCollections}</div>
                    <div className="text-sm text-gray-300">Blockchain Verified</div>
                  </div>
                  <div className="bg-yellow-500/20 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-yellow-300">{stats.totalNFTs}</div>
                    <div className="text-sm text-gray-300">Total NFTs</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
                  <div className="bg-blue-500/20 rounded-lg p-4 text-center">
                    <div className="text-xl font-bold text-blue-300">{stats.whitelistedNFTs}</div>
                    <div className="text-sm text-gray-300">Whitelisted NFTs</div>
                  </div>
                  <div className="bg-purple-500/20 rounded-lg p-4 text-center">
                    <div className="text-xl font-bold text-purple-300">{stats.blockchainVerifiedNFTs}</div>
                    <div className="text-sm text-gray-300">Blockchain Verified NFTs</div>
                  </div>
                  <div className="bg-orange-500/20 rounded-lg p-4 text-center">
                    <div className="text-xl font-bold text-orange-300">{stats.newlyVerifiedNFTs}</div>
                    <div className="text-sm text-gray-300">Newly Discovered</div>
                  </div>
                </div>
              </div>
            )}

            {/* Results Display */}
            {verificationResults.length > 0 && (
              <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6">
                <h2 className="text-2xl font-bold text-white mb-4">
                  ✅ Verified NFTs ({verificationResults.length})
                </h2>
                <div className="space-y-4">
                  {verificationResults.map((result, index) => (
                    <div key={index} className="bg-white/5 rounded-lg p-4 border border-white/10">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <EnhancedVerifiedBadge
                            isWhitelisted={result.isWhitelisted}
                            isBlockchainVerified={result.isBlockchainVerified}
                            verificationMethod={result.verificationMethod}
                            name={result.name || result.symbol}
                            showDetails={true}
                          />
                          <span className="text-sm text-gray-400">
                            {result.standard}
                          </span>
                        </div>
                        <div className="text-sm text-gray-400">
                          Balance: {result.balance}
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                        <div>
                          <span className="text-gray-400">Contract:</span>
                          <div className="font-mono text-xs text-gray-300 truncate">
                            {result.contractAddress}
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-400">Token ID:</span>
                          <div className="font-mono text-xs text-gray-300">
                            {result.tokenId}
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-400">Owner:</span>
                          <div className="font-mono text-xs text-gray-300 truncate">
                            {result.owner}
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-400">Method:</span>
                          <div className="text-xs text-gray-300 capitalize">
                            {result.verificationMethod}
                          </div>
                        </div>
                      </div>

                      {result.error && (
                        <div className="mt-2 text-xs text-red-400">
                          Error: {result.error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* No Results */}
            {verificationResults.length === 0 && !isLoading && stats && (
              <div className="text-center">
                <div className="bg-yellow-500/20 border border-yellow-500/50 rounded-lg p-6">
                  <p className="text-yellow-300 text-lg">
                    No verified NFTs found in your wallet
                  </p>
                  <p className="text-gray-400 text-sm mt-2">
                    This means either you don't own any NFTs, or they're not in the verified collections
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
} 
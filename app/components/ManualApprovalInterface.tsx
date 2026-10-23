'use client';

import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { toast } from 'react-hot-toast';
import { approveNFTForTrading, checkNFTApproval } from '@/services/blockchain';

interface NFTApprovalItem {
  contractAddress: string;
  tokenId: string;
  amount: string;
  standard: 'ERC721' | 'ERC1155';
  isApproved: boolean;
  isApproving: boolean;
}

interface ManualApprovalInterfaceProps {
  requiredApprovals: {
    contractAddress: string;
    tokenId: string;
    amount: string;
    standard: 'ERC721' | 'ERC1155';
  }[];
  onApprovalComplete: () => void;
  isVisible: boolean;
}

export default function ManualApprovalInterface({ 
  requiredApprovals, 
  onApprovalComplete, 
  isVisible 
}: ManualApprovalInterfaceProps) {
  const { address } = useAccount();
  const [approvals, setApprovals] = useState<NFTApprovalItem[]>([]);
  const [isChecking, setIsChecking] = useState(false);

  // Initialize approval items
  useEffect(() => {
    if (requiredApprovals.length > 0) {
      setApprovals(requiredApprovals.map(approval => ({
        ...approval,
        isApproved: false,
        isApproving: false,
      })));
    }
  }, [requiredApprovals]);

  // Check approval status for all NFTs
  const checkAllApprovals = async () => {
    if (!address || approvals.length === 0) return;

    setIsChecking(true);
    try {
      const updatedApprovals = await Promise.all(
        approvals.map(async (approval) => {
          try {
            const isApproved = await checkNFTApproval(
              approval.contractAddress,
              address,
              approval.standard
            );
            return { ...approval, isApproved };
          } catch (error) {
            console.error(`Error checking approval for ${approval.contractAddress}:`, error);
            return { ...approval, isApproved: false };
          }
        })
      );

      setApprovals(updatedApprovals);

      // Check if all are approved
      const allApproved = updatedApprovals.every(approval => approval.isApproved);
      if (allApproved) {
        toast.success('All NFTs approved. You can proceed with the trade.', {
          duration: 3500,
        });
        onApprovalComplete();
      }
    } catch (error) {
      console.error('Error checking approvals:', error);
      toast.error('Failed to check approval status. Please try again.');
    } finally {
      setIsChecking(false);
    }
  };

  // Check approvals on mount and when address changes
  useEffect(() => {
    if (isVisible && address && approvals.length > 0) {
      checkAllApprovals();
    }
  }, [isVisible, address, approvals.length]);

  // Approve a specific NFT
  const handleApproveNFT = async (index: number) => {
    if (!address) {
      toast.error('Please connect your wallet first');
      return;
    }

    const approval = approvals[index];
    
    // Update state to show approving
    setApprovals(prev => prev.map((item, i) => 
      i === index ? { ...item, isApproving: true } : item
    ));

    try {
      toast.loading(`Approving ${approval.standard}...`, {
        id: `approve-${index}`,
        duration: 0,
      });

      await approveNFTForTrading(
        approval.contractAddress,
        approval.standard,
        // @ts-ignore - wagmi hook provides the wallet client
        window.ethereum
      );

      toast.success(`${approval.standard} approved successfully!`, {
        id: `approve-${index}`,
        duration: 3000,
      });

      // Update approval status
      setApprovals(prev => prev.map((item, i) => 
        i === index ? { ...item, isApproved: true, isApproving: false } : item
      ));

      // Check if all are now approved
      const updatedApprovals = approvals.map((item, i) => 
        i === index ? { ...item, isApproved: true, isApproving: false } : item
      );
      
      const allApproved = updatedApprovals.every(approval => approval.isApproved);
      if (allApproved) {
        setTimeout(() => {
          toast.success('All NFTs approved. You can proceed with the trade.', {
            duration: 3500,
          });
          onApprovalComplete();
        }, 1000);
      }

    } catch (error) {
      console.error('Approval failed:', error);
      toast.error(`Failed to approve ${approval.standard}. Please try again.`, {
        id: `approve-${index}`,
        duration: 5000,
      });

      // Reset approving state
      setApprovals(prev => prev.map((item, i) => 
        i === index ? { ...item, isApproving: false } : item
      ));
    }
  };

  // Approve all NFTs at once
  const handleApproveAll = async () => {
    const unapprovedItems = approvals
      .map((approval, index) => ({ approval, index }))
      .filter(({ approval }) => !approval.isApproved);

    if (unapprovedItems.length === 0) {
      onApprovalComplete();
      return;
    }

    toast.loading(`Approving ${unapprovedItems.length} NFT contract(s)...`, {
      id: 'approve-all',
      duration: 0,
    });

    let successCount = 0;
    let failureCount = 0;

    for (const { approval, index } of unapprovedItems) {
      try {
        setApprovals(prev => prev.map((item, i) => 
          i === index ? { ...item, isApproving: true } : item
        ));

        await approveNFTForTrading(
          approval.contractAddress,
          approval.standard,
          // @ts-ignore - wagmi hook provides the wallet client
          window.ethereum
        );

        setApprovals(prev => prev.map((item, i) => 
          i === index ? { ...item, isApproved: true, isApproving: false } : item
        ));

        successCount++;
      } catch (error) {
        console.error(`Failed to approve ${approval.contractAddress}:`, error);
        setApprovals(prev => prev.map((item, i) => 
          i === index ? { ...item, isApproving: false } : item
        ));
        failureCount++;
      }
    }

    if (successCount === unapprovedItems.length) {
      toast.success('All NFTs approved successfully!', {
        id: 'approve-all',
        duration: 3500,
      });
      onApprovalComplete();
    } else {
      toast.error(`${successCount} succeeded, ${failureCount} failed. Please retry failed approvals.`, {
        id: 'approve-all',
        duration: 6000,
      });
    }
  };

  if (!isVisible || approvals.length === 0) {
    return null;
  }

  const allApproved = approvals.every(approval => approval.isApproved);
  const hasUnapproved = approvals.some(approval => !approval.isApproved);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-gray-300 dark:border-gray-700 transition-colors duration-300">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white transition-colors duration-300">NFT Approval Required</h2>
              <p className="text-gray-600 dark:text-gray-400 text-sm transition-colors duration-300">
                You need to approve these NFTs for trading before proceeding
              </p>
            </div>
          </div>

          <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-lg transition-colors duration-300">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0 transition-colors duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-sm">
                <p className="text-blue-800 dark:text-blue-300 font-medium mb-1 transition-colors duration-300">Why do I need to approve?</p>
                <p className="text-blue-700 dark:text-blue-200 transition-colors duration-300">
                  Approving allows the trading contract to transfer your NFTs when a trade is executed. 
                  This is a one-time action per NFT contract and is required for security.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4 mb-6">
            {approvals.map((approval, index) => (
              <div 
                key={`${approval.contractAddress}-${approval.tokenId}`}
                className={`p-4 rounded-lg border transition-colors duration-300 ${
                  approval.isApproved 
                    ? 'bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/30' 
                    : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`px-2 py-1 text-xs rounded-full transition-colors duration-300 ${
                        approval.standard === 'ERC721' 
                          ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-800 dark:text-purple-300' 
                          : 'bg-orange-100 dark:bg-orange-500/20 text-orange-800 dark:text-orange-300'
                      }`}>
                        {approval.standard}
                      </span>
                      <span className="text-gray-700 dark:text-gray-300 text-sm transition-colors duration-300">
                        Token ID: {approval.tokenId}
                      </span>
                      {approval.standard === 'ERC1155' && (
                        <span className="text-gray-600 dark:text-gray-400 text-sm transition-colors duration-300">
                          Amount: {approval.amount}
                        </span>
                      )}
                    </div>
                    <p className="text-gray-600 dark:text-gray-400 text-sm font-mono transition-colors duration-300">
                      {approval.contractAddress}
                    </p>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    {approval.isApproved ? (
                      <div className="flex items-center gap-2 text-green-600 dark:text-green-400 transition-colors duration-300">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-sm font-medium">Approved</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleApproveNFT(index)}
                        disabled={approval.isApproving || isChecking}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors duration-300 flex items-center gap-2"
                      >
                        {approval.isApproving ? (
                          <>
                            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="31.416" strokeDashoffset="31.416">
                                <animate attributeName="stroke-dasharray" dur="2s" values="0 31.416;15.708 15.708;0 31.416" repeatCount="indefinite"/>
                                <animate attributeName="stroke-dashoffset" dur="2s" values="0;-15.708;-31.416" repeatCount="indefinite"/>
                              </circle>
                            </svg>
                            Approving...
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Approve
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Enhanced Action Buttons */}
          <div className="space-y-4">
            {/* Primary Approve All Button - More Prominent */}
            {hasUnapproved && (
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-500/10 dark:to-indigo-500/10 border border-blue-200 dark:border-blue-500/30 rounded-lg p-4 transition-colors duration-300">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-white transition-colors duration-300">Quick Action</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 transition-colors duration-300">
                      Approve all {approvals.filter(a => !a.isApproved).length} NFT contracts at once
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleApproveAll}
                  disabled={isChecking || approvals.some(a => a.isApproving)}
                  className="w-full px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed text-white rounded-lg font-bold text-lg transition-all duration-300 flex items-center justify-center gap-3 shadow-lg hover:shadow-xl transform hover:scale-[1.02]"
                >
                  {isChecking ? (
                    <>
                      <svg className="w-6 h-6 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="31.416" strokeDashoffset="31.416">
                          <animate attributeName="stroke-dasharray" dur="2s" values="0 31.416;15.708 15.708;0 31.416" repeatCount="indefinite"/>
                          <animate attributeName="stroke-dashoffset" dur="2s" values="0;-15.708;-31.416" repeatCount="indefinite"/>
                        </circle>
                      </svg>
                      Checking Approvals...
                    </>
                  ) : approvals.some(a => a.isApproving) ? (
                    <>
                      <svg className="w-6 h-6 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="31.416" strokeDashoffset="31.416">
                          <animate attributeName="stroke-dasharray" dur="2s" values="0 31.416;15.708 15.708;0 31.416" repeatCount="indefinite"/>
                          <animate attributeName="stroke-dashoffset" dur="2s" values="0;-15.708;-31.416" repeatCount="indefinite"/>
                        </circle>
                      </svg>
                      Approving All NFTs...
                    </>
                  ) : (
                    <>
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      🚀 Approve All NFTs ({approvals.filter(a => !a.isApproved).length})
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Secondary Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={checkAllApprovals}
                disabled={isChecking || approvals.some(a => a.isApproving)}
                className="flex-1 px-4 py-3 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:bg-gray-300 dark:disabled:bg-gray-800 disabled:cursor-not-allowed text-gray-900 dark:text-white rounded-lg font-medium transition-colors duration-300 flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh Status
              </button>

              {allApproved && (
                <button
                  onClick={onApprovalComplete}
                  className="flex-1 px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 shadow-lg"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                  Continue to Trade
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 
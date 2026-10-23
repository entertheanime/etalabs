'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useAccount } from 'wagmi'
import Link from 'next/link'
import { createPublicClient, http, parseAbiItem, decodeEventLog } from 'viem'
import { MONAD_NFT_TRADING_V6_ADDRESS, CONTRACT_V6_CONFIG } from '@/lib/contracts'
import { useWalletClient } from 'wagmi'
import { ACTIVE_CHAIN, RPC_URL, EXPLORER_URL } from '@/lib/chain'

const publicClient = createPublicClient({
  chain: ACTIVE_CHAIN as any,
  transport: http(RPC_URL)
})

interface Trade {
  id: string
  creatorAddress: string
  targetUserAddress?: string
  status: string
  createdAt: any
  source: 'firebase' | 'blockchain'
  isOrphaned?: boolean
  creatorNFTs?: any[]
  targetNFTs?: any[]
  creatorMonadAmount?: string
  targetMonadAmount?: string
  userRole?: 'creator' | 'responder'
  from?: string
  to?: string
  blockchainTradeId?: string // The actual blockchain trade ID
}

interface MyTradesProps {
  className?: string
  variant?: 'button' | 'link'
}

export default function MyTrades({ className = '', variant = 'button' }: MyTradesProps) {
  const { address, isConnected } = useAccount()
  const { data: walletClient } = useWalletClient()
  const [isOpen, setIsOpen] = useState(false)
  const [trades, setTrades] = useState<Trade[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'active' | 'recover'>('all')
  const [txHash, setTxHash] = useState('')
  const [isRecovering, setIsRecovering] = useState(false)
  const [recoveryError, setRecoveryError] = useState<string | null>(null)
  const [recoveryResult, setRecoveryResult] = useState<{
    tradeId: string
    blockNumber: string
    trade: any
    offeredNFTs: any[]
    requestedNFTs: any[]
    canCancel: boolean
  } | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)
  const [cancellingTradeId, setCancellingTradeId] = useState<string | null>(null)
  const [isCancellingAll, setIsCancellingAll] = useState(false)
  
  // Add helper to format trade ID
  const formatTradeId = (id: string) => {
    if (!id) return '';
    // Keep first 4 and last 4 characters
    return `#${id.slice(0, 4)}...${id.slice(-4)}`;
  };
  
  // Count pending trades where user is responder
  const pendingResponderTrades = trades.filter(trade => 
    trade.userRole === 'responder' && 
    trade.status && 
    (trade.status.toLowerCase() === 'pending' || trade.status.toLowerCase() === 'active')
  ).length

  const fetchTrades = async () => {
    if (!address) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/user-trades?address=${address}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch trades')
      }

      setTrades(data.trades || [])
    } catch (err) {
      console.error('Error fetching trades:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch trades')
    } finally {
      setLoading(false)
    }
  }

  // Auto-fetch trades on mount to show notification badge
  useEffect(() => {
    if (address && isConnected) {
      fetchTrades()
    }
  }, [address, isConnected])

  const handleToggle = () => {
    if (!isOpen && address) {
      fetchTrades()
    }
    setIsOpen(!isOpen)
  }

  const copyTradeLink = (tradeId: string) => {
    const url = `${window.location.origin}/trade/${tradeId}`
    navigator.clipboard.writeText(url)
    // You could add a toast notification here
  }

  const isValidTxHash = (hash: string) => {
    return /^0x[a-fA-F0-9]{64}$/.test(hash)
  }

  const handleRecover = async () => {
    if (!txHash.trim()) {
      setRecoveryError('Please enter a transaction hash')
      return
    }

    if (!isValidTxHash(txHash)) {
      setRecoveryError('Invalid transaction hash format. Must be 64 characters long and start with 0x')
      return
    }

    setIsRecovering(true)
    setRecoveryError(null)
    setRecoveryResult(null)

    try {
      console.log('🔍 Starting recovery process...')
      console.log('📝 Transaction hash:', txHash)
      console.log('🌐 Public client:', publicClient)
      console.log('📍 V6 Contract address:', MONAD_NFT_TRADING_V6_ADDRESS)
      
      console.log('📡 Fetching transaction receipt...')
      
      // Get transaction receipt
      const receipt = await publicClient.getTransactionReceipt({
        hash: txHash as `0x${string}`
      })

      console.log('✅ Transaction receipt received:', receipt)

      if (!receipt) {
        console.log('❌ Receipt is null/undefined')
        throw new Error('Transaction not found. Please check the hash and try again.')
      }

      if (receipt.status === 'reverted') {
        console.log('❌ Transaction was reverted')
        throw new Error('Transaction failed. The trade was not created successfully.')
      }

      console.log('✅ Transaction was successful, proceeding to analyze logs...')

      console.log('Transaction logs:', receipt.logs)
      console.log('Looking for V6 contract address:', MONAD_NFT_TRADING_V6_ADDRESS)
      console.log('Transaction details:', {
        from: receipt.from,
        to: receipt.to,
        status: receipt.status,
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPrice: receipt.effectiveGasPrice?.toString()
      })
      
      // Look for TradeCreated event in the logs (V6 only)
      const tradeCreatedEvent = parseAbiItem('event TradeCreated(uint256 indexed tradeId, address indexed creator, address indexed counterparty)')
      
      let tradeId = null
      let foundV6Logs = false
      
      for (const log of receipt.logs) {
        const isV6Contract = log.address.toLowerCase() === MONAD_NFT_TRADING_V6_ADDRESS.toLowerCase()
        
        console.log('Checking log - address:', log.address, 'isV6Contract:', isV6Contract)
        
                  if (isV6Contract) {
            foundV6Logs = true
            console.log('Found log from V6 contract, attempting to decode...')
            
            try {
              // Try to decode as TradeCreated event
              const decoded = decodeEventLog({
                abi: [tradeCreatedEvent],
                data: log.data,
                topics: (log as any).topics as [`0x${string}`, ...`0x${string}`[]]
              })
              
              console.log('Decoded event:', decoded)
              
              if (decoded.eventName === 'TradeCreated') {
                tradeId = (decoded.args as any).tradeId?.toString()
                console.log('Found trade ID:', tradeId)
                break
              }
            } catch (decodeError) {
              console.log('Failed to decode log as TradeCreated:', decodeError)
              
              // Try to decode with full V6 ABI to see what event this actually is
              try {
                const decodedAny = decodeEventLog({
                  abi: CONTRACT_V6_CONFIG.abi,
                  data: log.data,
                  topics: (log as any).topics as [`0x${string}`, ...`0x${string}`[]]
                })
                console.log('Decoded as other V6 event:', decodedAny)
              } catch (anyDecodeError) {
                console.log('Could not decode as any V6 event:', anyDecodeError)
              }
            }
          }
      }
      
      if (!foundV6Logs) {
        console.log('❌ No logs found from V6 contract in this transaction')
        console.log('This transaction might be:')
        console.log('- An approval transaction (setApprovalForAll)')
        console.log('- A transaction to a different contract')
        console.log('- A failed transaction')
        throw new Error('This transaction does not interact with the V6 trading contract. Please make sure you are using the transaction hash from when you created the trade, not from NFT approvals.')
      }

      if (!tradeId) {
        console.log('No trade ID found. This might be:')
        console.log('1. Not a trade creation transaction')
        console.log('2. A transaction to a different contract version')
        console.log('3. A failed transaction')
        console.log('4. A transaction with different event signature')
        throw new Error('No trade creation found in this transaction. This might not be a trade creation transaction or could be from a different contract version.')
      }

      console.log('Found trade ID:', tradeId, 'Now fetching full trade details...')

      // Create contract instance for reading
      const contract = {
        address: MONAD_NFT_TRADING_V6_ADDRESS as `0x${string}`,
        abi: CONTRACT_V6_CONFIG.abi,
      }

      // Fetch full trade details from blockchain
      const [trade, offeredNFTs, requestedNFTs] = await Promise.all([
        publicClient.readContract({
          ...contract,
          functionName: 'getTrade',
          args: [BigInt(tradeId)]
        }),
        publicClient.readContract({
          ...contract,
          functionName: 'getOfferedNFTs',
          args: [BigInt(tradeId)]
        }),
        publicClient.readContract({
          ...contract,
          functionName: 'getRequestedNFTs',
          args: [BigInt(tradeId)]
        })
      ])

      console.log('Trade details:', { trade, offeredNFTs, requestedNFTs })

      // Check if user is the creator (can cancel)
      console.log('🔍 Checking if user can cancel trade:')
      console.log('- User address:', address)
      console.log('- Trade creator:', trade[1])
      console.log('- Trade status:', trade[6], '(0=Active, 1=Accepted, 2=Cancelled, 3=Expired, 4=Declined)')
      console.log('- Address match:', address && trade[1].toLowerCase() === address.toLowerCase())
      console.log('- Status is Active:', trade[6] === 0)
      
      const canCancel = address && trade[1].toLowerCase() === address.toLowerCase() && trade[6] === 0 // status 0 = Active
      console.log('- Final canCancel result:', canCancel)

      setRecoveryResult({
        tradeId,
        blockNumber: receipt.blockNumber.toString(),
        trade,
        offeredNFTs: [...offeredNFTs],
        requestedNFTs: [...requestedNFTs],
        canCancel
      })

      // Refresh trades to show the recovered trade
      await fetchTrades()

    } catch (err) {
      console.error('Recovery error:', err)
      setRecoveryError(err instanceof Error ? err.message : 'Failed to recover trade')
    } finally {
      setIsRecovering(false)
    }
  }

  const handleCancelTrade = async () => {
    if (!recoveryResult || !walletClient) return

    setIsCancelling(true)
    setRecoveryError(null)

    try {
      console.log('Cancelling trade:', recoveryResult.tradeId)

      // Call cancelTrade on the contract
      const hash = await walletClient.writeContract({
        address: MONAD_NFT_TRADING_V6_ADDRESS as `0x${string}`,
        abi: CONTRACT_V6_CONFIG.abi,
        functionName: 'cancelTrade',
        args: [BigInt(recoveryResult.tradeId)],
        account: address as `0x${string}`,
        chain: ACTIVE_CHAIN as any
      })

      console.log('Cancel transaction sent:', hash)

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ 
        hash: hash as `0x${string}` 
      })
      console.log('Trade cancelled successfully:', receipt)

      // Update the recovery result to show it's cancelled
      setRecoveryResult(prev => prev ? {
        ...prev,
        canCancel: false,
        trade: [...prev.trade.slice(0, 6), 2, ...prev.trade.slice(7)] // status 2 = Cancelled
      } : null)

      // Refresh trades list
      await fetchTrades()

    } catch (err) {
      console.error('Cancel error:', err)
      setRecoveryError(err instanceof Error ? err.message : 'Failed to cancel trade')
    } finally {
      setIsCancelling(false)
    }
  }

  // Enhanced cancel function for regular trades
  const handleCancelRegularTrade = async (trade: Trade) => {
    if (!address) return

    setCancellingTradeId(trade.id)
    setError(null)

    try {
      console.log('🗑️ Cancelling trade:', trade.id)

      // Try Firebase cancellation first (for database cleanup)
      const response = await fetch(`/api/user-trades`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeId: trade.id, userAddress: address })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to cancel trade in database')
      }

      console.log('✅ Trade cancelled in Firebase')

      // If this is a blockchain trade (has blockchainTradeId), also cancel/decline on blockchain
      if (trade.blockchainTradeId && walletClient) {
        console.log('🔗 Also processing on blockchain...')
        console.log('🔢 Blockchain Trade ID:', trade.blockchainTradeId)
        
        try {
          let hash: string
          
          // Determine if this is a cancel (creator) or decline (responder)
          if (trade.userRole === 'creator') {
            console.log('🗑️ Cancelling trade on blockchain (user is creator)')
            hash = await walletClient.writeContract({
              address: MONAD_NFT_TRADING_V6_ADDRESS as `0x${string}`,
              abi: CONTRACT_V6_CONFIG.abi,
              functionName: 'cancelTrade',
              args: [BigInt(trade.blockchainTradeId)],
              account: address as `0x${string}`,
              chain: ACTIVE_CHAIN as any
            })
          } else {
            console.log('❌ Declining trade on blockchain (user is responder)')
            hash = await walletClient.writeContract({
              address: MONAD_NFT_TRADING_V6_ADDRESS as `0x${string}`,
              abi: CONTRACT_V6_CONFIG.abi,
              functionName: 'declineTrade',
              args: [BigInt(trade.blockchainTradeId)],
              account: address as `0x${string}`,
              chain: ACTIVE_CHAIN as any
            })
          }

          console.log('📝 Blockchain transaction sent:', hash)
          
          // Wait for confirmation
          const receipt = await publicClient.waitForTransactionReceipt({ 
            hash: hash as `0x${string}` 
          })
          console.log('✅ Trade processed on blockchain:', receipt)
          console.log('💰 Assets returned to original owners')
        } catch (blockchainError) {
          console.warn('⚠️ Blockchain operation failed, but Firebase update succeeded:', blockchainError)
          // Don't throw here - Firebase update is more important for UX
          // The user will see the trade as declined/cancelled in the UI
        }
      } else if (!trade.blockchainTradeId) {
        console.log('📝 Firebase-only trade, no blockchain action needed')
      } else {
        console.log('⚠️ No wallet client available for blockchain operation')
      }

      // Refresh the trades list
      await fetchTrades()
      
      console.log('🎉 Trade cancellation completed')

    } catch (err) {
      console.error('❌ Cancel error:', err)
      setError(err instanceof Error ? err.message : 'Failed to cancel trade')
    } finally {
      setCancellingTradeId(null)
    }
  }

  const handleCancelAllTrades = async () => {
    if (!address) return
    
    // Get all pending trades where user is the creator
    const pendingCreatorTrades = trades.filter(trade => 
      trade.status && 
      trade.status.toLowerCase() === 'pending' && 
      trade.userRole === 'creator'
    )

    if (pendingCreatorTrades.length === 0) {
      return
    }

    // Confirm with user
    const confirmed = window.confirm(
      `Are you sure you want to cancel all ${pendingCreatorTrades.length} pending trades you created? This action cannot be undone.`
    )

    if (!confirmed) return

    setIsCancellingAll(true)
    let successCount = 0
    let errorCount = 0

    try {
      // Cancel trades one by one
      for (const trade of pendingCreatorTrades) {
        try {
          console.log(`🗑️ Cancelling trade ${trade.id}`)

          // Try Firebase cancellation first (for database cleanup)
          const response = await fetch(`/api/user-trades`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tradeId: trade.id, userAddress: address })
          })

          if (!response.ok) {
            const errorData = await response.json()
            throw new Error(errorData.error || 'Failed to cancel trade in database')
          }

          // If this is a blockchain trade (has blockchainTradeId), also cancel on blockchain
          if (trade.blockchainTradeId && walletClient) {
            console.log(`🔗 Also cancelling on blockchain for trade ${trade.id}`)
            
            try {
              const hash = await walletClient.writeContract({
                address: MONAD_NFT_TRADING_V6_ADDRESS as `0x${string}`,
                abi: CONTRACT_V6_CONFIG.abi,
                functionName: 'cancelTrade',
                args: [BigInt(trade.blockchainTradeId)],
                account: address as `0x${string}`,
                chain: ACTIVE_CHAIN as any
              })

              console.log(`📝 Blockchain transaction sent for trade ${trade.id}:`, hash)
              
              // Wait for confirmation
              const receipt = await publicClient.waitForTransactionReceipt({ 
                hash: hash as `0x${string}` 
              })
              console.log(`✅ Trade ${trade.id} processed on blockchain:`, receipt)
            } catch (blockchainError) {
              console.warn(`⚠️ Blockchain operation failed for trade ${trade.id}, but Firebase update succeeded:`, blockchainError)
            }
          }

          successCount++
        } catch (error) {
          console.error(`❌ Error cancelling trade ${trade.id}:`, error)
          errorCount++
        }
      }

      // Refresh the trades list
      await fetchTrades()

      // Show summary
      if (successCount > 0) {
        console.log(`🎉 Successfully cancelled ${successCount} trades`)
      }
      if (errorCount > 0) {
        console.log(`⚠️ Failed to cancel ${errorCount} trades`)
      }
      
    } catch (error) {
      console.error('❌ Error in bulk cancel:', error)
      setError('Failed to cancel all trades. Some may have been cancelled successfully.')
    } finally {
      setIsCancellingAll(false)
    }
  }

  const handleDeclineAllTrades = async () => {
    if (!address) return
    
    // Get all pending trades where user is the responder
    const pendingResponderTrades = trades.filter(trade => 
      trade.status && 
      trade.status.toLowerCase() === 'pending' && 
      trade.userRole === 'responder'
    )

    if (pendingResponderTrades.length === 0) {
      return
    }

    // Confirm with user
    const confirmed = window.confirm(
      `Are you sure you want to decline all ${pendingResponderTrades.length} incoming trade offers? This action cannot be undone.`
    )

    if (!confirmed) return

    setIsCancellingAll(true) // Reusing the same loading state
    let successCount = 0
    let errorCount = 0

    try {
      // Decline trades one by one
      for (const trade of pendingResponderTrades) {
        try {
          console.log(`❌ Declining trade ${trade.id}`)

          // Try Firebase decline first (for database cleanup)
          const response = await fetch(`/api/user-trades`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tradeId: trade.id, userAddress: address })
          })

          if (!response.ok) {
            const errorData = await response.json()
            throw new Error(errorData.error || 'Failed to decline trade in database')
          }

          // If this is a blockchain trade (has blockchainTradeId), also decline on blockchain
          if (trade.blockchainTradeId && walletClient) {
            console.log(`🔗 Also declining on blockchain for trade ${trade.id}`)
            
            try {
              const hash = await walletClient.writeContract({
                address: MONAD_NFT_TRADING_V6_ADDRESS as `0x${string}`,
                abi: CONTRACT_V6_CONFIG.abi,
                functionName: 'declineTrade',
                args: [BigInt(trade.blockchainTradeId)],
                account: address as `0x${string}`,
                chain: ACTIVE_CHAIN as any
              })

              console.log(`📝 Blockchain transaction sent for trade ${trade.id}:`, hash)
              
              // Wait for confirmation
              const receipt = await publicClient.waitForTransactionReceipt({ 
                hash: hash as `0x${string}` 
              })
              console.log(`✅ Trade ${trade.id} declined on blockchain:`, receipt)
            } catch (blockchainError) {
              console.warn(`⚠️ Blockchain operation failed for trade ${trade.id}, but Firebase update succeeded:`, blockchainError)
            }
          }

          successCount++
        } catch (error) {
          console.error(`❌ Error declining trade ${trade.id}:`, error)
          errorCount++
        }
      }

      // Refresh the trades list
      await fetchTrades()

      // Show summary
      if (successCount > 0) {
        console.log(`🎉 Successfully declined ${successCount} trades`)
      }
      if (errorCount > 0) {
        console.log(`⚠️ Failed to decline ${errorCount} trades`)
      }
      
    } catch (error) {
      console.error('❌ Error in bulk decline:', error)
      setError('Failed to decline all trades. Some may have been declined successfully.')
    } finally {
      setIsCancellingAll(false)
    }
  }

  const formatDate = (date: any) => {
    try {
      if (date?.toDate) {
        return date.toDate().toLocaleDateString()
      }
      if (date?.seconds) {
        return new Date(date.seconds * 1000).toLocaleDateString()
      }
      if (date instanceof Date) {
        return date.toLocaleDateString()
      }
      if (typeof date === 'string') {
        return new Date(date).toLocaleDateString()
      }
      return 'Unknown'
    } catch {
      return 'Unknown'
    }
  }

  const formatDateTime = (date: any) => {
    try {
      let dateObj: Date | null = null;
      
      if (date?.toDate) {
        dateObj = date.toDate()
      } else if (date?.seconds) {
        dateObj = new Date(date.seconds * 1000)
      } else if (date instanceof Date) {
        dateObj = date
      } else if (typeof date === 'string') {
        dateObj = new Date(date)
      }
      
      if (!dateObj) return 'Unknown'
      
      // Format: "7/4/2025, 2:30 PM"
      return dateObj.toLocaleString('en-US', {
        month: 'numeric',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })
    } catch {
      return 'Unknown'
    }
  }

  const getRelativeTime = (date: any) => {
    try {
      let dateObj: Date | null = null;
      
      if (date?.toDate) {
        dateObj = date.toDate()
      } else if (date?.seconds) {
        dateObj = new Date(date.seconds * 1000)
      } else if (date instanceof Date) {
        dateObj = date
      } else if (typeof date === 'string') {
        dateObj = new Date(date)
      }
      
      if (!dateObj) return ''
      
      const now = new Date()
      const diffMs = now.getTime() - dateObj.getTime()
      const diffMins = Math.floor(diffMs / 60000)
      const diffHours = Math.floor(diffMs / 3600000)
      const diffDays = Math.floor(diffMs / 86400000)
      
      if (diffMins < 1) return 'just now'
      if (diffMins < 60) return `${diffMins}m ago`
      if (diffHours < 24) return `${diffHours}h ago`
      if (diffDays < 7) return `${diffDays}d ago`
      return '' // For older dates, just show the full date
    } catch {
      return ''
    }
  }

  const getStatusColor = (status: string) => {
    if (!status) return 'text-gray-400'
    switch (status.toLowerCase()) {
      case 'active':
      case 'pending':
        return 'text-green-400'
      case 'accepted':
        return 'text-blue-400'
      case 'cancelled':
        return 'text-gray-400'
      case 'expired':
        return 'text-orange-400'
      case 'declined':
        return 'text-red-400'
      default:
        return 'text-gray-400'
    }
  }

  // Filter trades based on selected filter
  const filteredTrades = trades.filter(trade => {
    if (filter === 'active') {
      return trade.status && (trade.status.toLowerCase() === 'active' || trade.status.toLowerCase() === 'pending')
    }
    return true // 'all' filter
  })

  if (!isConnected) {
    return null
  }

  const buttonContent = variant === 'button' ? (
    <button
      onClick={handleToggle}
      className={`relative bg-green-500 hover:bg-green-400 text-black px-4 py-2 rounded-lg transition-colors ${className}`}
    >
      My Trades
      {pendingResponderTrades > 0 && (
        <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full min-w-[20px] h-5 flex items-center justify-center px-1">
          {pendingResponderTrades}
        </span>
      )}
    </button>
  ) : (
    <button
      onClick={handleToggle}
      className={`relative text-green-400 hover:text-green-300 transition-colors ${className}`}
    >
      My Trades
      {pendingResponderTrades > 0 && (
        <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full min-w-[20px] h-5 flex items-center justify-center px-1">
          {pendingResponderTrades}
        </span>
      )}
    </button>
  )

  return (
    <div className="relative">
      {buttonContent}

      {isOpen && typeof window !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[99999]" style={{ zIndex: 99999 }}>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setIsOpen(false)}
          />

          {/* Modal */}
          <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 glass-card rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden backdrop-blur-2xl border border-white/20 dark:border-gray-600/20">
            <div className="p-4 sm:p-6 border-b border-white/20 dark:border-gray-600/20 glass-light">
              <div className="flex justify-between items-center mb-3">
                                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">My Trades</h2>
                  <button
                    onClick={() => setIsOpen(false)}
                    className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                  >
                    ✕
                  </button>
              </div>
              
              {/* Tab buttons and Cancel All - Mobile Responsive */}
              <div className="space-y-3">
                {/* Tab buttons */}
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => setFilter('all')}
                    className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm transition-colors ring-1 ${
                      filter === 'all' 
                        ? 'bg-blue-600 text-white ring-blue-500/40 shadow' 
                        : 'bg-zinc-900/50 text-zinc-300 hover:bg-zinc-800 ring-zinc-800'
                    }`}
                  >
                    Recent Activity
                  </button>
                  <button
                    onClick={() => setFilter('active')}
                    className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm transition-colors ring-1 ${
                      filter === 'active' 
                        ? 'bg-green-600 text-black ring-green-500/40 shadow' 
                        : 'bg-zinc-900/50 text-zinc-300 hover:bg-zinc-800 ring-zinc-800'
                    }`}
                  >
                    Active Trades ({filteredTrades.filter(t => t.status && (t.status.toLowerCase() === 'active' || t.status.toLowerCase() === 'pending')).length})
                  </button>
                  <button
                    onClick={() => setFilter('recover')}
                    className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm transition-colors flex items-center gap-1 ring-1 ${
                      filter === 'recover' 
                        ? 'bg-orange-600 text-black ring-orange-500/40 shadow' 
                        : 'bg-zinc-900/50 text-orange-400 hover:bg-zinc-800 ring-zinc-800'
                    }`}
                  >
                    <span>🔄</span>
                    <span className="hidden sm:inline">Recover</span>
                  </button>
                </div>

                {/* Bulk Action buttons - Mobile Responsive */}
                {(() => {
                  const pendingCreatorTrades = trades.filter(trade => 
                    trade.status && 
                    trade.status.toLowerCase() === 'pending' && 
                    trade.userRole === 'creator'
                  )
                  
                  const pendingResponderTrades = trades.filter(trade => 
                    trade.status && 
                    trade.status.toLowerCase() === 'pending' && 
                    trade.userRole === 'responder'
                  )
                  
                  const buttons = []
                  
                  // Cancel All button for creator trades
                  if (pendingCreatorTrades.length > 0) {
                    buttons.push(
                      <button
                        key="cancel-all"
                        onClick={handleCancelAllTrades}
                        disabled={isCancellingAll}
                        className={`flex-1 sm:flex-none px-3 py-2 rounded-lg text-xs sm:text-sm transition-colors flex items-center justify-center gap-1 ${
                          isCancellingAll
                            ? 'bg-gray-400 text-gray-300 cursor-not-allowed'
                            : 'bg-red-600 hover:bg-red-700 text-white shadow-lg'
                        }`}
                      >
                        {isCancellingAll ? (
                          <>
                            <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin"></div>
                            <span>Cancelling...</span>
                          </>
                        ) : (
                          <>
                            <span>🗑️</span>
                            <span>Cancel All ({pendingCreatorTrades.length})</span>
                          </>
                        )}
                      </button>
                    )
                  }
                  
                  // Decline All button for responder trades
                  if (pendingResponderTrades.length > 0) {
                    buttons.push(
                      <button
                        key="decline-all"
                        onClick={handleDeclineAllTrades}
                        disabled={isCancellingAll}
                        className={`flex-1 sm:flex-none px-3 py-2 rounded-lg text-xs sm:text-sm transition-colors flex items-center justify-center gap-1 ${
                          isCancellingAll
                            ? 'bg-gray-400 text-gray-300 cursor-not-allowed'
                            : 'bg-orange-600 hover:bg-orange-700 text-white shadow-lg'
                        }`}
                      >
                        {isCancellingAll ? (
                          <>
                            <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin"></div>
                            <span>Declining...</span>
                          </>
                        ) : (
                          <>
                            <span>❌</span>
                            <span>Decline All ({pendingResponderTrades.length})</span>
                          </>
                        )}
                      </button>
                    )
                  }
                  
                  if (buttons.length > 0) {
                    return (
                      <div className="flex gap-2 w-full">
                        {buttons}
                      </div>
                    )
                  }
                  
                  return null
                })()}
              </div>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto max-h-[60vh]">
              {loading && (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
                                      <p className="text-gray-600 dark:text-gray-400 mt-2">Loading your trades...</p>
                </div>
              )}

              {error && (
                <div className="text-center py-8">
                  <p className="text-red-400">Error: {error}</p>
                  <button
                    onClick={fetchTrades}
                    className="mt-2 text-blue-400 hover:text-blue-300"
                  >
                    Try Again
                  </button>
                </div>
              )}

              {!loading && !error && filteredTrades.length === 0 && trades.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-gray-400 mb-4">No trades found</p>
                  <div className="space-y-2">
                    <Link
                      href="/trade/create"
                      className="block text-blue-400 hover:text-blue-300"
                      onClick={() => setIsOpen(false)}
                    >
                      Create your first trade
                    </Link>
                    <Link
                      href="/settings"
                      className="block text-sm text-gray-500 hover:text-gray-400"
                      onClick={() => setIsOpen(false)}
                    >
                      Lost a trade? Recover it here →
                    </Link>
                  </div>
                </div>
              )}

              {!loading && !error && filteredTrades.length === 0 && trades.length > 0 && (
                <div className="text-center py-8">
                  <p className="text-gray-400">No {filter} trades found</p>
                  <button
                    onClick={() => setFilter('all')}
                    className="mt-2 text-blue-400 hover:text-blue-300"
                  >
                    Show recent activity
                  </button>
                </div>
              )}

              {!loading && !error && filter !== 'recover' && filteredTrades.length > 0 && (
                <div className="flex flex-col gap-4 p-4">
                  {filteredTrades.map((trade) => (
                    <div
                      key={trade.id}
                      className="relative bg-white/5 backdrop-blur-lg rounded-2xl p-4 border border-white/10 hover:border-white/20 transition-all duration-200"
                    >
                      {/* Small ID display in top right */}
                      <div className="absolute top-2 right-2 text-xs text-gray-400 font-mono">
                        ID: {trade.blockchainTradeId || '71'}
                      </div>

                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono">
                            {trade.id}
                          </span>
                          {trade.userRole === 'creator' && (
                            <span className="text-xs bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full">
                              You Created
                            </span>
                          )}
                        </div>

                        <div className="text-sm text-gray-400">
                          <div>Created: {formatDateTime(trade.createdAt)}</div>
                          {getRelativeTime(trade.createdAt) && (
                            <div className="text-xs text-gray-500 mt-0.5">
                              {getRelativeTime(trade.createdAt)}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-sm text-zinc-400">Status</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ring-1 ${
                            (trade.status || '').toLowerCase() === 'pending'
                              ? 'bg-amber-500/15 text-amber-300 ring-amber-400/20'
                              : (trade.status || '').toLowerCase() === 'accepted'
                              ? 'bg-green-500/15 text-green-300 ring-green-400/20'
                              : (trade.status || '').toLowerCase() === 'cancelled'
                              ? 'bg-zinc-700/40 text-zinc-300 ring-zinc-600/30'
                              : 'bg-zinc-800 text-zinc-300 ring-zinc-700/40'
                          }`}>
                            {trade.status?.toUpperCase()}
                          </span>
                        </div>

                        <div className="flex gap-2 mt-2">
                          <Link
                            href={`/trade/${trade.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-4 py-1.5 bg-green-500 text-black rounded-lg text-sm hover:bg-green-400 transition-colors"
                          >
                            View
                          </Link>
                          <button
                            onClick={() => copyTradeLink(trade.id)}
                            className="px-4 py-1.5 bg-zinc-800 text-zinc-300 rounded-lg text-sm hover:bg-zinc-700 transition-colors"
                          >
                            Copy Link
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Recovery Section */}
              {filter === 'recover' && (
                <div className="space-y-4">
                  <div className="text-center py-4">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                      Recover Trade Assets
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                      Paste your transaction hash to recover assets from orphaned trades or cancel pending offers
                    </p>
                  </div>

                  <div className="glass-card rounded-xl p-4 border border-white/20 dark:border-gray-600/20">
                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                      Transaction Hash
                    </label>
                    <input
                      type="text"
                      value={txHash}
                      onChange={(e) => setTxHash(e.target.value)}
                      placeholder="Enter transaction hash (0x...)"
                      className="w-full bg-white dark:bg-gray-900 border-2 border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all placeholder-gray-500 dark:placeholder-gray-400"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Find your transaction hash on <a href={EXPLORER_URL} target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:text-orange-400">Robinhood Chain Explorer</a>
                    </p>
                  </div>

                  {/* Error Display */}
                  {recoveryError && (
                    <div className="glass-card rounded-xl p-4 border border-red-500/20 bg-red-500/10">
                      <div className="flex items-start gap-2">
                        <span className="text-red-400 text-sm">⚠️</span>
                        <div>
                          <p className="text-red-300 font-medium text-sm">Recovery Failed</p>
                          <p className="text-red-200 text-xs mt-1">{recoveryError}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Success Display */}
                  {recoveryResult && (
                    <div className="space-y-4">
                      <div className="glass-card rounded-xl p-4 border border-green-500/20 bg-green-500/10">
                        <div className="flex items-start gap-2">
                          <span className="text-green-400 text-sm">✅</span>
                          <div className="flex-1">
                            <p className="text-green-300 font-medium mb-2 text-sm">Trade Found Successfully!</p>
                            <div className="space-y-1 text-xs text-green-200">
                              <p><strong>Trade ID:</strong> #{recoveryResult.tradeId}</p>
                              <p><strong>Block Number:</strong> {recoveryResult.blockNumber}</p>
                              <p><strong>Status:</strong> {
                                recoveryResult.trade[6] === 0 ? 'Active' :
                                recoveryResult.trade[6] === 1 ? 'Accepted' :
                                recoveryResult.trade[6] === 2 ? 'Cancelled' :
                                recoveryResult.trade[6] === 3 ? 'Expired' :
                                recoveryResult.trade[6] === 4 ? 'Declined' : 'Unknown'
                              }</p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Trade Details */}
                      <div className="glass-card rounded-xl p-4 border border-white/20 dark:border-gray-600/20">
                        <h4 className="font-medium text-gray-900 dark:text-white mb-3 text-sm">Your Locked Assets</h4>
                        
                        {/* Offered NFTs */}
                        {recoveryResult.offeredNFTs.length > 0 && (
                          <div className="mb-3">
                            <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">NFTs ({recoveryResult.offeredNFTs.length}):</p>
                            <div className="space-y-1">
                              {recoveryResult.offeredNFTs.map((nft: any, index: number) => (
                                <div key={index} className="text-xs text-gray-700 dark:text-gray-300 bg-white/10 dark:bg-gray-800/20 rounded px-2 py-1">
                                  <span className="font-mono">{nft.contractAddress.slice(0, 8)}...{nft.contractAddress.slice(-6)}</span>
                                  <span className="mx-2">#{nft.tokenId.toString()}</span>
                                  <span className="text-gray-500">x{nft.amount.toString()}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Offered MONAD */}
                        {recoveryResult.trade[3] > 0 && (
                          <div className="mb-3">
                            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">MONAD Offered:</p>
                            <div className="text-xs text-gray-700 dark:text-gray-300 bg-white/10 dark:bg-gray-800/20 rounded px-2 py-1">
                              {(Number(recoveryResult.trade[3]) / 1e18).toFixed(4)} MON
                            </div>
                          </div>
                        )}

                        {/* Recovery Action */}
                        <div className="mt-4">
                          {recoveryResult.canCancel ? (
                            <button
                              onClick={handleCancelTrade}
                              disabled={isCancelling}
                              className={`w-full px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                isCancelling
                                  ? 'bg-gray-400 dark:bg-gray-600 text-gray-300 cursor-not-allowed'
                                  : 'bg-orange-600 hover:bg-orange-700 text-white shadow-lg'
                              }`}
                            >
                              {isCancelling ? (
                                <div className="flex items-center justify-center gap-2">
                                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                  Recovering Assets...
                                </div>
                                                              ) : (
                                  'Recover Assets'
                                )}
                            </button>
                          ) : (
                                                         <div className="text-center py-3 px-4 text-sm">
                               {recoveryResult.trade[6] === 2 ? (
                                 <div className="text-green-600 dark:text-green-400">
                                   <div className="font-medium mb-1">✅ Trade Already Cancelled</div>
                                   <div className="text-xs opacity-80">Your assets have already been recovered and returned to your wallet.</div>
                                 </div>
                               ) : recoveryResult.trade[6] === 1 ? (
                                 <div className="text-blue-600 dark:text-blue-400">
                                   <div className="font-medium mb-1">🤝 Trade Was Accepted</div>
                                   <div className="text-xs opacity-80">This trade was completed successfully. Assets have been exchanged and cannot be recovered.</div>
                                 </div>
                               ) : recoveryResult.trade[6] === 3 ? (
                                 <div className="text-orange-600 dark:text-orange-400">
                                   <div className="font-medium mb-1">⏰ Trade Has Expired</div>
                                   <div className="text-xs opacity-80">This trade expired. Your assets should be automatically claimable from the contract.</div>
                                 </div>
                               ) : recoveryResult.trade[6] === 4 ? (
                                 <div className="text-red-600 dark:text-red-400">
                                   <div className="font-medium mb-1">❌ Trade Was Declined</div>
                                   <div className="text-xs opacity-80">The other party declined this trade. Your assets have been returned to your wallet.</div>
                                 </div>
                               ) : !address ? (
                                 <div className="text-gray-600 dark:text-gray-400">
                                   <div className="font-medium mb-1">🔐 Wallet Not Connected</div>
                                   <div className="text-xs opacity-80">Please connect your wallet to recover assets from this trade.</div>
                                 </div>
                               ) : address && recoveryResult.trade[1].toLowerCase() !== address.toLowerCase() ? (
                                 <div className="text-yellow-600 dark:text-yellow-400">
                                   <div className="font-medium mb-1">👤 You Are Not The Creator</div>
                                   <div className="text-xs opacity-80">Only the original creator of this trade can recover its assets. This trade belongs to someone else.</div>
                                 </div>
                               ) : (
                                 <div className="text-gray-600 dark:text-gray-400">
                                   <div className="font-medium mb-1">❓ Cannot Recover Trade</div>
                                   <div className="text-xs opacity-80">This trade cannot be recovered at this time. Please check the trade status.</div>
                                 </div>
                               )}
                             </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {!recoveryResult && (
                    <div className="flex justify-center">
                      <button
                        onClick={handleRecover}
                        disabled={!txHash.trim() || isRecovering}
                        className={`px-6 py-2 rounded-xl font-medium transition-all text-sm ${
                          txHash.trim() && !isRecovering
                            ? 'bg-orange-600 hover:bg-orange-700 text-white shadow-lg'
                            : 'bg-gray-400 dark:bg-gray-600 text-gray-300 cursor-not-allowed'
                        }`}
                      >
                        {isRecovering ? (
                          <div className="flex items-center gap-2">
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            Finding Trade...
                          </div>
                        ) : (
                          'Find My Trade'
                        )}
                      </button>
                    </div>
                  )}

                  <div className="glass-card rounded-xl p-4 border border-orange-500/20 bg-orange-500/10">
                    <div className="flex items-start gap-2">
                      <span className="text-orange-500 text-sm">⚠️</span>
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        <p className="font-medium text-orange-600 dark:text-orange-400 mb-1">How Recovery Works:</p>
                        <ul className="space-y-1 text-xs">
                          <li>• Enter your transaction hash from a trade creation</li>
                          <li>• System validates you're the original sender</li>
                          <li>• If trade is orphaned, it gets restored to your trades</li>
                          <li>• If trade is pending, you can cancel and reclaim assets</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              )}
                         </div>
           </div>
         </div>,
         document.body
       )}
    </div>
  )
} 
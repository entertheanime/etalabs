import { ethers } from 'ethers';
import { CONTRACT_CONFIG, TRADE_FEE, getOptimalProvider, HYPER_RPC_SUPPORTED_METHODS, getTradeContractAddress, getKnownTradeContractAddresses, isAllowedTradeContract, LEGACY_ESCROW_TRADE_ADDRESS } from '@/lib/contracts';
import { runtimeChain } from '@/lib/networkPref';
import { getSharedTradeContract, saveSharedTradeContract } from '@/lib/sharedTradeContract';
import { NFT } from '@/types/nft';
import { TradeData } from '@/types/trade';
import { ethMissingMessage, friendlyTradeError, isConfirmedMissingNft, nftMissingMessage } from '@/lib/tradeErrors';

// Simple rate limiter to prevent hitting QuickNode limits
class RateLimiter {
  private queue: (() => Promise<any>)[] = [];
  private processing = false;
  private readonly delay = 50; // 50ms between calls = max 20 calls/second (under 25/sec limit)
  private cache = new Map<string, { result: any; timestamp: number }>();
  private readonly cacheTimeout = 60000; // 1 minute cache

  async execute<T>(fn: () => Promise<T>, cacheKey?: string): Promise<T> {
    // Check cache first if key provided
    if (cacheKey) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
        console.log(`📋 Cache hit for ${cacheKey}`);
        return cached.result;
      }
    }

    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await fn();
          
          // Cache result if key provided
          if (cacheKey) {
            this.cache.set(cacheKey, { result, timestamp: Date.now() });
            console.log(`💾 Cached result for ${cacheKey}`);
          }
          
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    
    while (this.queue.length > 0) {
      const fn = this.queue.shift()!;
      await fn();
      
      // Add delay between calls to respect rate limits
      if (this.queue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, this.delay));
      }
    }
    
    this.processing = false;
  }
}

// Create global rate limiter instance
const rateLimiter = new RateLimiter();

// Smart provider that routes to optimal endpoint
class OptimalProvider {
  private hyperRpcProvider: ethers.JsonRpcProvider;
  private standardRpcProvider: ethers.JsonRpcProvider;
  private chainId = 0;

  constructor() {
    const providers = getOptimalProvider();
    this.hyperRpcProvider = new ethers.JsonRpcProvider(providers.hyperRpc);
    this.standardRpcProvider = new ethers.JsonRpcProvider(providers.standardRpc);
  }

  // Route method to optimal provider
  getProvider(method?: string): ethers.JsonRpcProvider {
    const chain = runtimeChain();
    if (this.chainId !== chain.id) {
      const rpc = chain.rpcUrls.default.http[0];
      this.hyperRpcProvider = new ethers.JsonRpcProvider(rpc, chain.id, { staticNetwork: true });
      this.standardRpcProvider = new ethers.JsonRpcProvider(rpc, chain.id, { staticNetwork: true });
      this.chainId = chain.id;
    }
    if (method && HYPER_RPC_SUPPORTED_METHODS.includes(method as any)) {
      console.log(`🚀 Using HyperRPC for ${method} (5x faster!)`);
      return this.hyperRpcProvider;
    }
    console.log(`📡 Using standard RPC for ${method || 'general use'}`);
    return this.standardRpcProvider;
  }

  // Get contract with optimal provider for the operation
  getContract(method?: string) {
    const provider = this.getProvider(method);
    return new ethers.Contract(CONTRACT_CONFIG.address, CONTRACT_CONFIG.abi, provider);
  }

  // Rate-limited getCode function with caching
  async getCode(address: string): Promise<string> {
    return rateLimiter.execute(async () => {
      const provider = this.getProvider();
      return provider.getCode(address);
    }, `getCode:${address}`);
  }
}

// Create singleton instance
export const optimalProvider = new OptimalProvider();

// Enhanced ERC1155 balance checking
export async function getERC1155Balance(
  contractAddress: string, 
  tokenId: string, 
  userAddress: string, 
  provider: ethers.Provider
): Promise<string> {
  try {
    const contract = new ethers.Contract(
      contractAddress,
      ['function balanceOf(address account, uint256 id) view returns (uint256)'],
      provider
    );
    
    const balance = await contract.balanceOf(userAddress, tokenId);
    return balance.toString();
  } catch (error) {
    console.error(`❌ Failed to get ERC1155 balance for ${contractAddress}:${tokenId}:`, error);
    return '0';
  }
}

// Check if contract supports ERC1155
export async function isERC1155Contract(contractAddress: string, provider: ethers.Provider): Promise<boolean> {
  try {
    const contract = new ethers.Contract(
      contractAddress,
      ['function supportsInterface(bytes4 interfaceId) view returns (bool)'],
      provider
    );
    
    const erc1155InterfaceId = '0xd9b67a26';
    return await contract.supportsInterface(erc1155InterfaceId);
  } catch (error) {
    return false;
  }
}

// Helper function to convert wallet client to ethers signer
export async function walletClientToSigner(walletClient: any): Promise<ethers.Signer> {
  const provider = new ethers.BrowserProvider(walletClient as any);
  return provider.getSigner();
}

const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
];

export async function ensureChogApproved(amount: bigint, spender: string, walletClient: any) {
  if (amount <= 0n) return;
  const { CHOG_TOKEN_ADDRESS } = await import('@/lib/chog');
  const signer = await walletClientToSigner(walletClient);
  const owner = await signer.getAddress();
  const token = new ethers.Contract(CHOG_TOKEN_ADDRESS, ERC20_ABI, signer);
  const [allowance, balance] = await Promise.all([token.allowance(owner, spender), token.balanceOf(owner)]);
  if (BigInt(balance) < amount) throw new Error('Not enough CHOG for this offer.');
  if (BigInt(allowance) >= amount) return;
  const tx = await token.approve(spender, amount);
  await tx.wait();
}

// Helper function to get read-only contract instance
export function getContract(signer?: ethers.Signer, address?: string) {
  if (!signer) return null;
  return new ethers.Contract(address || CONTRACT_CONFIG.address, CONTRACT_CONFIG.abi, signer);
}

export async function contractFeeFor(contract: ethers.Contract, account: string): Promise<bigint> {
  try {
    return BigInt(await contract.feeFor(account));
  } catch {
    return BigInt(await contract.tradeFee());
  }
}

async function listTradeContracts(extra: string[] = []): Promise<string[]> {
  const shared = await getSharedTradeContract(runtimeChain().id);
  const ordered = [...extra, shared, ...getKnownTradeContractAddresses()]
    .filter((addr): addr is string => Boolean(addr) && isAllowedTradeContract(addr))
    .map((addr) => addr.toLowerCase());
  return [...new Set(ordered)];
}

async function contractFromFirebase(tradeId: string): Promise<string | undefined> {
  try {
    const { collection, getDocs, limit, query, where } = await import('firebase/firestore');
    const { db } = await import('@/lib/firebase');
    const snap = await getDocs(
      query(collection(db, 'trades'), where('blockchainTradeId', '==', String(tradeId)), limit(5))
    );
    for (const docSnap of snap.docs) {
      const addr = docSnap.data()?.tradeContract;
      if (typeof addr === 'string' && isAllowedTradeContract(addr)) return addr;
    }
  } catch {
    /* ignore */
  }
}

export async function ensureCollectionsApproved(
  nfts: Array<{ contractAddress: string; tokenId: string; standard?: number | string }>,
  walletClient: any,
  operatorAddress?: string,
  progress?: (message: string) => void
): Promise<void> {
  const operator = operatorAddress || getTradeContractAddress();
  if (!isAllowedTradeContract(operator)) {
    throw new Error('This offer is not on the live trade contract.');
  }
  const seen = new Set<string>();
  for (const nft of nfts) {
    const key = (nft.contractAddress || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const is1155 = nft.standard === 1 || nft.standard === 'ERC1155';
        progress?.(is1155 ? 'Approve this collection in your EVM wallet…' : 'Approve this collection in your EVM wallet…');
    if (is1155) {
      await approveERC1155ForTrading(nft.contractAddress, walletClient, operator);
    } else {
      await approveERC721ForTrading(nft.contractAddress, String(nft.tokenId), walletClient, operator);
    }
  }
}

export async function findContractWithTrade(tradeId: string, preferred?: string): Promise<string> {
  const trustedPreferred =
    preferred && isAllowedTradeContract(preferred) ? preferred.toLowerCase() : undefined;
  const fromFirebase = trustedPreferred ? undefined : await contractFromFirebase(tradeId);
  const addresses = await listTradeContracts(
    trustedPreferred ? [trustedPreferred] : fromFirebase ? [fromFirebase] : []
  );
  const provider = optimalProvider.getProvider();
  for (const addr of addresses) {
    try {
      const contract = new ethers.Contract(addr, CONTRACT_CONFIG.abi, provider);
      const trade = await contract.trades(BigInt(tradeId));
      const creator = trade.creator || trade[1];
      if (creator && creator !== ethers.ZeroAddress) return addr;
    } catch {
      continue;
    }
  }
  throw new Error('Trade does not exist');
}

export interface CreateTradeParams {
  counterpartyAddress: string;
  userNFTs: Array<{ contractAddress: string; tokenId: string; amount?: string; standard?: number }>;
  counterpartyNFTs: Array<{ contractAddress: string; tokenId: string; amount?: string; standard?: number }>;
  userMonadAmount: string;
  counterpartyMonadAmount: string;
  userChogAmount?: string;
  counterpartyChogAmount?: string;
  message: string;
  durationSeconds?: number;
}

// Create a new trade on the blockchain
export async function createTrade(
  params: CreateTradeParams,
  walletClient: any,
  progress?: (phase: 'wallet' | 'chain' | 'link') => void
): Promise<string> {
  const signer = await walletClientToSigner(walletClient);
  const sender = await signer.getAddress();
  if (params.counterpartyAddress.toLowerCase() === sender.toLowerCase()) {
    throw new Error('Choose a different wallet for the other side. You cannot send a trade offer to yourself.');
  }
  const contract = getContract(signer);
  if (!contract) throw new Error('Contract not available');

  let offeredNFTs: any[] = [];
  let requestedNFTs: any[] = [];

  try {
    console.log('🔍 STARTING TRADE CREATION WITH APPROVAL CHECKS');
    console.log('================================================');

    // Add integer wei amounts; decimal floating-point addition can lose precision.
    const userAmount = ethers.parseEther(params.userMonadAmount || '0');
    const userAddress = await signer.getAddress();
    const tradeFeeWei = await contractFeeFor(contract, userAddress);
    const totalValue = userAmount + BigInt(tradeFeeWei);

    console.log(`👤 User Address: ${userAddress}`);
    console.log(`💰 Total Value Required: ${ethers.formatEther(totalValue)} MONAD`);

    const { parseChog } = await import('@/lib/chog');
    const offeredChog = parseChog(params.userChogAmount);
    const requestedChog = parseChog(params.counterpartyChogAmount);
    await ensureCollectionsApproved(params.userNFTs, walletClient, CONTRACT_CONFIG.address);
    if (offeredChog > 0n) {
      await ensureChogApproved(offeredChog, CONTRACT_CONFIG.address, walletClient);
    }

    const { classifyOfferItems } = await import('@/lib/transferPolicy');
    const afterApprove = await classifyOfferItems(
      [
        ...params.userNFTs.map((nft) => ({
          contractAddress: nft.contractAddress,
          tokenId: nft.tokenId,
          owner: userAddress,
          recipient: params.counterpartyAddress,
          standard: nft.standard === 1 ? 'ERC1155' : 'ERC721',
        })),
        ...params.counterpartyNFTs.map((nft) => ({
          contractAddress: nft.contractAddress,
          tokenId: nft.tokenId,
          owner: params.counterpartyAddress,
          recipient: userAddress,
          standard: nft.standard === 1 ? 'ERC1155' : 'ERC721',
        })),
      ],
      undefined,
      { fresh: true }
    );
    if (afterApprove.blocked.length) {
      throw new Error(
        `${afterApprove.blocked.join(', ')} cannot go in-wallet. Send this offer as Escrow, or wait if the NFT is time-locked.`
      );
    }
    if (!afterApprove.canInWallet) {
      throw new Error(
        afterApprove.unknown.length
          ? `Could not confirm ${afterApprove.unknown.join(', ')} after approval. Wait, or send as Escrow.`
          : 'In-wallet send is not confirmed after approval.'
      );
    }

    // Prepare NFT arrays for the new contract format with ERC1155 support
    offeredNFTs = await Promise.all(params.userNFTs.map(async (nft) => {
      let standard = nft.standard;
      let amount = nft.amount || "1";
      
      console.log(`\n🔍 Processing offered NFT: ${nft.contractAddress}:${nft.tokenId}`);
      
      // Auto-detect token standard if not provided
      if (standard === undefined) {
        try {
          standard = await contract.detectTokenStandard(nft.contractAddress);
          console.log(`✅ Detected token standard: ${standard === 0 ? 'ERC721' : 'ERC1155'}`);
        } catch (error) {
          console.warn(`⚠️ Could not detect token standard, defaulting to ERC721`);
          standard = 0; // Default to ERC721
        }
      }

      // COMPREHENSIVE APPROVAL AND OWNERSHIP CHECKS
      if (standard === 0) { // ERC721
        console.log(`📋 Verifying ERC721 NFT...`);
        
        const erc721Contract = new ethers.Contract(
          nft.contractAddress,
          [
            'function ownerOf(uint256 tokenId) view returns (address)',
            'function getApproved(uint256 tokenId) view returns (address)',
            'function isApprovedForAll(address owner, address operator) view returns (bool)',
            'function approve(address to, uint256 tokenId)',
            'function setApprovalForAll(address operator, bool approved)'
          ],
          signer
        );

        // Check ownership
        try {
          const owner = await erc721Contract.ownerOf(nft.tokenId);
          if (owner.toLowerCase() !== userAddress.toLowerCase()) {
            throw new Error(`❌ You don't own this NFT. Owner: ${owner}, You: ${userAddress}`);
          }
          console.log(`✅ Ownership confirmed`);
        } catch (error) {
          throw new Error(`❌ Failed to verify ownership: ${error.message}`);
        }

        // Check approval status with enhanced error handling
        try {
          let approvedAddress = ethers.ZeroAddress;
          let isApprovedForAll = false;
          
          try {
            approvedAddress = await erc721Contract.getApproved(nft.tokenId);
          } catch (getApprovedError) {
            console.warn(`⚠️ Could not check getApproved:`, getApprovedError.message);
          }
          
          try {
            isApprovedForAll = await erc721Contract.isApprovedForAll(userAddress, CONTRACT_CONFIG.address);
          } catch (isApprovedForAllError) {
            console.warn(`⚠️ Could not check isApprovedForAll:`, isApprovedForAllError.message);
          }
          
          console.log(`📝 Current approval status:`);
          console.log(`   - getApproved: ${approvedAddress}`);
          console.log(`   - isApprovedForAll: ${isApprovedForAll}`);

          const isApproved = (
            approvedAddress.toLowerCase() === CONTRACT_CONFIG.address.toLowerCase() ||
            isApprovedForAll
          );

          if (!isApproved) {
            console.log('📝 NFT not approved yet — requesting setApprovalForAll');
            const approveTx = await erc721Contract.setApprovalForAll(CONTRACT_CONFIG.address, true);
            await approveTx.wait();
            console.log('✅ ERC721 approval confirmed');
          } else {
            console.log(`✅ ERC721 approval confirmed`);
          }
        } catch (error) {
          if (error.message.includes('ERC721 NFT not approved')) {
            throw error;
          }
          
          // Enhanced error handling for approval check failures
          throw new Error(
            `❌ Failed to verify ERC721 approval status!\n\n` +
            `This could be due to:\n` +
            `• Network connectivity issues\n` +
            `• Contract compatibility issues\n` +
            `• RPC rate limiting\n\n` +
            `To fix this:\n` +
            `1. Try refreshing the page and attempting again\n` +
            `2. Ensure your NFT is approved: approve("${CONTRACT_CONFIG.address}", ${nft.tokenId})\n` +
            `3. Or approve all: setApprovalForAll("${CONTRACT_CONFIG.address}", true)\n` +
            `4. Check your network connection\n\n` +
            `Contract: ${nft.contractAddress}\n` +
            `Token ID: ${nft.tokenId}\n` +
            `Trading Contract: ${CONTRACT_CONFIG.address}\n\n` +
            `Error: ${error.message}`
          );
        }

        // Ensure amount is 1 for ERC721
        amount = "1";
      }
      
      // Smart handling for ERC1155 open editions
      if (standard === 1) {
        console.log(`📦 Verifying ERC1155 NFT...`);
        
        try {
          const erc1155Contract = new ethers.Contract(
            nft.contractAddress,
            [
              'function balanceOf(address account, uint256 id) view returns (uint256)',
              'function isApprovedForAll(address account, address operator) view returns (bool)',
              'function setApprovalForAll(address operator, bool approved)'
            ],
            signer
          );
          
          // Check balance
          const balance = await erc1155Contract.balanceOf(userAddress, nft.tokenId);
          console.log(`💰 User balance for token ${nft.tokenId}: ${balance.toString()}`);
          
          if (balance.toString() === "0") {
            throw new Error(`❌ You don't own any copies of token ID ${nft.tokenId} in this collection`);
          }
          
          // Check if trading contract is approved with enhanced error handling
          let isApproved = false;
          try {
            isApproved = await erc1155Contract.isApprovedForAll(userAddress, CONTRACT_CONFIG.address);
            console.log(`📝 ERC1155 approval status: ${isApproved}`);
          } catch (approvalCheckError) {
            console.error(`❌ Failed to check approval status:`, approvalCheckError);
            
            // If we can't check approval, assume it's not approved and provide guidance
            throw new Error(
              `❌ Unable to verify ERC1155 approval status!\n\n` +
              `This could be due to:\n` +
              `• Network connectivity issues\n` +
              `• Contract compatibility issues\n` +
              `• RPC rate limiting\n\n` +
              `To fix this:\n` +
              `1. Try refreshing the page and attempting again\n` +
              `2. Ensure your NFTs are approved: setApprovalForAll("${CONTRACT_CONFIG.address}", true)\n` +
              `3. Check your network connection\n\n` +
              `Contract: ${nft.contractAddress}\n` +
              `Token ID: ${nft.tokenId}\n` +
              `Trading Contract: ${CONTRACT_CONFIG.address}\n\n` +
              `Error: ${approvalCheckError.message}`
            );
          }
          
          if (!isApproved) {
            const approveTx = await erc1155Contract.setApprovalForAll(CONTRACT_CONFIG.address, true);
            await approveTx.wait();
          }
          console.log(`✅ ERC1155 approval confirmed`);
          
        } catch (approvalError) {
          console.error('❌ ERC1155 validation failed:', approvalError);
          throw approvalError;
        }
        
        // Ensure amount is at least 1 for ERC1155
        if (!amount || amount === "0") {
          amount = "1";
        }
        
        // Validate requested amount doesn't exceed balance
        const requestedAmount = parseInt(amount);
        const balance = await new ethers.Contract(
          nft.contractAddress,
          ['function balanceOf(address account, uint256 id) view returns (uint256)'],
          signer
        ).balanceOf(userAddress, nft.tokenId);
        
        if (requestedAmount > parseInt(balance.toString())) {
          throw new Error(`❌ Insufficient balance. You have ${balance} but trying to trade ${requestedAmount}`);
        }
      }
      
      return {
        contractAddress: nft.contractAddress,
        tokenId: nft.tokenId,
        amount: amount,
        standard: standard
      };
    }));
    
    requestedNFTs = await Promise.all(params.counterpartyNFTs.map(async (nft) => {
      let standard = nft.standard;
      let amount = nft.amount || "1";
      
      console.log(`\n🔍 Processing requested NFT: ${nft.contractAddress}:${nft.tokenId}`);
      
      // Auto-detect token standard if not provided
      if (standard === undefined) {
        try {
          standard = await contract.detectTokenStandard(nft.contractAddress);
          console.log(`✅ Detected token standard: ${standard === 0 ? 'ERC721' : 'ERC1155'}`);
        } catch (error) {
          console.warn(`⚠️ Could not detect token standard, defaulting to ERC721`);
          standard = 0; // Default to ERC721
        }
      }

      // Basic validation for requested NFTs (no approval needed)
      try {
        const code = await optimalProvider.getCode(nft.contractAddress);
        if (code === '0x') {
          throw new Error(`❌ Requested NFT contract does not exist: ${nft.contractAddress}`);
        }
        console.log(`✅ Requested NFT contract exists`);
      } catch (error) {
        throw new Error(`❌ Invalid requested NFT contract: ${error.message}`);
      }
      
      return {
        contractAddress: nft.contractAddress,
        tokenId: nft.tokenId,
        amount: amount,
        standard: standard
      };
    }));

    console.log('\n🎯 ALL APPROVALS VERIFIED - PROCEEDING WITH TRADE CREATION');
    console.log('=========================================================');

    console.log('Creating trade with params:', {
      counterparty: params.counterpartyAddress,
      offeredNFTs: {
        count: offeredNFTs.length,
        details: offeredNFTs.map(nft => ({
          contract: nft.contractAddress,
          tokenId: nft.tokenId,
          amount: nft.amount,
          standard: nft.standard === 0 ? 'ERC721' : 'ERC1155'
        }))
      },
      requestedNFTs: {
        count: requestedNFTs.length,
        details: requestedNFTs.map(nft => ({
          contract: nft.contractAddress,
          tokenId: nft.tokenId,
          amount: nft.amount,
          standard: nft.standard === 0 ? 'ERC721' : 'ERC1155'
        }))
      },
      offeredMONAD: params.userMonadAmount,
      requestedMONAD: params.counterpartyMonadAmount,
      totalValue: ethers.formatEther(totalValue),
      message: params.message
    });

    // Call the smart contract with new signature
    console.log(`\n📡 Calling createTrade on contract...`);
    const { clampOfferDuration, MAX_IN_WALLET_OFFER_DURATION } = await import('@/lib/offerExpiry');
    const durationSeconds = clampOfferDuration(params.durationSeconds || 60 * 60, MAX_IN_WALLET_OFFER_DURATION);
    const tx = await contract.createTrade(
      params.counterpartyAddress,
      offeredNFTs,
      requestedNFTs,
      ethers.parseEther(params.userMonadAmount),
      ethers.parseEther(params.counterpartyMonadAmount),
      offeredChog,
      requestedChog,
      params.message,
      durationSeconds,
      { value: totalValue }
    );

    console.log('✅ Transaction sent:', tx.hash);
    progress?.('chain');
    const receipt = await tx.wait();
    progress?.('link');
    console.log('✅ Transaction confirmed:', receipt);

    // Extract trade ID from logs
    const tradeCreatedEvent = receipt.logs.find((log: any) => {
      try {
        const decoded = contract.interface.parseLog(log);
        return decoded?.name === 'TradeCreated';
      } catch {
        return false;
      }
    });

    if (tradeCreatedEvent) {
      const decoded = contract.interface.parseLog(tradeCreatedEvent);
      const tradeId = decoded?.args[0].toString();
      console.log('🎉 Trade created with ID:', tradeId);
      await saveSharedTradeContract(CONTRACT_CONFIG.address, runtimeChain().id);
      return tradeId;
    }

    throw new Error('Trade creation event not found in transaction logs');

  } catch (error) {
    console.error('❌ Error creating trade:', error);
    
    // Enhanced error handling with specific approval guidance
    if (error.message?.includes('not approved for trading')) {
      // Re-throw approval errors with full context
      throw error;
    }
    
    if (error.message?.includes('missing revert data') || error.message?.includes('CALL_EXCEPTION')) {
      throw new Error(friendlyTradeError(error));
    }
    
    throw error;
  }
}

// Accept a trade with automatic approval handling
export async function acceptTrade(
  tradeId: string,
  walletClient: any,
  progressCallback?: (message: string) => void,
  tradeContract?: string
): Promise<string> {
  const signer = await walletClientToSigner(walletClient);
  const contractAddress = await findContractWithTrade(String(tradeId), tradeContract);
  const contract = getContract(signer, contractAddress);
  if (!contract) throw new Error('Contract not available');

  const updateProgress = (message: string) => {
    console.log(message);
    if (progressCallback) progressCallback(message);
  };

  try {
    updateProgress('Starting trade acceptance with auto-approval...');
    
    // Step 1: Check and handle NFT approvals
    updateProgress('Checking required NFT approvals...');
    const requiredApprovals = await getRequiredApprovalsForTrade(tradeId, walletClient, true, contractAddress);
    
    if (requiredApprovals.length > 0) {
      updateProgress(`Found ${requiredApprovals.length} NFTs requiring approval`);
      
      // Auto-approve each required NFT
      for (let i = 0; i < requiredApprovals.length; i++) {
        const approval = requiredApprovals[i];
        updateProgress(`Approving ${approval.standard} NFT (${i + 1}/${requiredApprovals.length}): ${approval.contractAddress.slice(0, 6)}...${approval.contractAddress.slice(-4)}`);
        
        if (approval.standard === 'ERC721') {
          await approveERC721ForTrading(approval.contractAddress, approval.tokenId, walletClient, contractAddress);
        } else {
          await approveERC1155ForTrading(approval.contractAddress, walletClient, contractAddress);
        }
        
        updateProgress(`Approved ${approval.standard} NFT (${i + 1}/${requiredApprovals.length})`);
      }
      
      updateProgress('All NFT approvals completed');
    } else {
      updateProgress('No NFT approvals required');
    }

    // Step 2: Execute the trade
    updateProgress('Executing trade transaction...');
    
    // Get trade details to determine required MONAD amount
    const trade = await contract.trades(tradeId);
    const requestedMONAD = trade.requestedETH ?? trade[4];
    const requestedChog = BigInt(trade.requestedChog ?? 0);

    // A failed fee read must stop acceptance rather than silently submit zero.
    const payer = await signer.getAddress();
    const tradeFee: bigint = await contractFeeFor(contract, payer);
    
    const totalRequired = requestedMONAD + tradeFee;
    if (requestedChog > 0n) {
      updateProgress('Approve CHOG for this offer…');
      await ensureChogApproved(requestedChog, contractAddress, walletClient);
    }

    console.log('Accepting trade:', {
      tradeId,
      requestedAmount: ethers.formatEther(requestedMONAD),
      tradeFee: ethers.formatEther(tradeFee),
      totalRequired: ethers.formatEther(totalRequired)
    });

    // Wallet gas estimation may discard revert data. Read-only simulation on
    // the configured chain RPC preserves collection transfer-policy errors.
    updateProgress('Checking whether the collection permits this trade...');
    const simulationContract = new ethers.Contract(
      contractAddress,
      CONTRACT_CONFIG.abi,
      optimalProvider.getProvider()
    );
    await simulationContract.acceptTrade.staticCall(tradeId, {
      from: await signer.getAddress(),
      value: totalRequired,
    });

    const tx = await contract.acceptTrade(tradeId, { value: totalRequired });
    updateProgress('Transaction sent, waiting for confirmation...');
    console.log('Accept transaction sent:', tx.hash);
    
    const receipt = await tx.wait();
    updateProgress('Trade accepted successfully');
    
    return receipt.hash;
  } catch (error: any) {
    console.error('Error accepting trade:', error);
    throw new Error(friendlyTradeError(error, {}));
  }
}

export async function expireTrade(tradeId: string, walletClient: any, tradeContract?: string): Promise<string> {
  const signer = await walletClientToSigner(walletClient);
  const contract = getContract(signer, await findContractWithTrade(String(tradeId), tradeContract));
  if (!contract) throw new Error('Contract not available');
  const tx = await contract.expireTrade(tradeId);
  const receipt = await tx.wait();
  return receipt.hash;
}

// Cancel a trade
export async function cancelTrade(tradeId: string, walletClient: any, tradeContract?: string): Promise<string> {
  const signer = await walletClientToSigner(walletClient);
  const contract = getContract(signer, await findContractWithTrade(String(tradeId), tradeContract));
  if (!contract) throw new Error('Contract not available');

  try {
    console.log('Cancelling trade:', tradeId);
    
    const tx = await contract.cancelTrade(tradeId);
    console.log('Cancel transaction sent:', tx.hash);
    
    const receipt = await tx.wait();
    console.log('Trade cancelled successfully');
    
    return receipt.hash;
  } catch (error) {
    console.error('Error cancelling trade:', error);
    throw error;
  }
}

export async function recoverEscrowedNfts(
  walletClient: any,
  progress?: (message: string) => void
): Promise<number> {
  const signer = await walletClientToSigner(walletClient);
  const user = (await signer.getAddress()).toLowerCase();
  const contract = getContract(signer, LEGACY_ESCROW_TRADE_ADDRESS);
  if (!contract) throw new Error('Old escrow contract not available');
  const created: bigint[] = await contract.getUserCreatedTrades(user);
  let cancelled = 0;
  for (const id of created) {
    try {
      const trade = await contract.getTrade(id);
      const status = Number(trade.status ?? trade[6]);
      const creator = String(trade.creator || trade[1]).toLowerCase();
      if (status !== 0 || creator !== user) continue;
      progress?.(`Returning NFTs from old escrow trade ${id.toString()}…`);
      const tx = await contract.cancelTrade(id);
      await tx.wait();
      cancelled += 1;
    } catch {
      continue;
    }
  }
  return cancelled;
}

// Get trade details from blockchain
export async function getTrade(tradeId: string): Promise<TradeData | null> {
  // Use HyperRPC for getLogs (much faster for event queries!)
  const contract = optimalProvider.getContract('eth_getLogs');
  
  try {
    console.log(`Fetching trade ${tradeId} from blockchain...`);
    
    const trade = await contract.trades(tradeId);
    
    if (!trade || trade.creator === ethers.ZeroAddress) {
      console.log(`Trade ${tradeId} not found or invalid`);
      return null;
    }

    // Convert BigInt values to strings for JSON serialization
    const tradeData: TradeData = {
      id: tradeId,
      creator: trade.creator,
      responder: trade.responder,
      creatorAssets: trade.creatorAssets.map((asset: any) => ({
        contractAddress: asset.contractAddress,
        tokenId: asset.tokenId.toString(),
        amount: asset.amount.toString(),
        standard: asset.standard
      })),
      responderAssets: trade.responderAssets.map((asset: any) => ({
        contractAddress: asset.contractAddress,
        tokenId: asset.tokenId.toString(),
        amount: asset.amount.toString(),
        standard: asset.standard
      })),
      status: Number(trade.status),
      createdAt: Number(trade.createdAt),
      
      acceptedAt: trade.acceptedAt ? Number(trade.acceptedAt) : undefined,
      cancelledAt: trade.cancelledAt ? Number(trade.cancelledAt) : undefined
    };

    console.log('✅ Trade fetched successfully:', tradeData);
    return tradeData;
  } catch (error) {
    console.error('❌ Error fetching trade:', error);
    return null;
  }
}

// ERC1155 Approval function (legacy - kept for compatibility)
// Note: Enhanced version available below with better logging and error handling

// Check if ERC1155 contract is approved for trading
export async function isERC1155ApprovedForTrading(contractAddress: string, userAddress: string): Promise<boolean> {
  // Use standard RPC for contract calls (eth_call is not in HyperRPC supported methods)
  const provider = optimalProvider.getProvider();
  
  const erc1155Abi = [
    'function isApprovedForAll(address owner, address operator) view returns (bool)'
  ];
  
  try {
    // First validate that the contract exists
    const code = await optimalProvider.getCode(contractAddress);
    if (code === '0x') {
      console.warn(`⚠️ Contract does not exist at address: ${contractAddress}`);
      return false;
    }
    
    const contract = new ethers.Contract(contractAddress, erc1155Abi, provider);
    
    console.log(`🔍 Checking isApprovedForAll for ${contractAddress}`);
    console.log(`  - Owner: ${userAddress}`);
    console.log(`  - Operator: ${CONTRACT_CONFIG.address}`);
    
    const isApproved = await contract.isApprovedForAll(userAddress, CONTRACT_CONFIG.address);
    console.log(`  - Result: ${isApproved}`);
    
    // Ensure we return a boolean
    return Boolean(isApproved);
  } catch (error) {
    console.error(`❌ Error checking approval for ${contractAddress}:`, error);
    console.log(`  - Error type: ${error.code || 'unknown'}`);
    console.log(`  - Error message: ${error.message}`);
    
    // Be conservative - if we can't check, assume not approved
    return false;
  }
}

// Utility functions

// Check if user can perform action on trade
export function canUserAcceptTrade(trade: TradeData, userAddress: string): boolean {
  return (
    trade.isActive &&
    !trade.isAccepted &&
    !trade.isCancelled &&
    trade.counterparty.toLowerCase() === userAddress.toLowerCase()
  );
}

export function canUserCancelTrade(trade: TradeData, userAddress: string): boolean {
  return (
    trade.isActive &&
    !trade.isAccepted &&
    !trade.isCancelled &&
    trade.creator.toLowerCase() === userAddress.toLowerCase()
  );
}

// Decline a trade (V5 contract function)
export async function declineTrade(tradeId: string, walletClient: any, tradeContract?: string): Promise<string> {
  const signer = await walletClientToSigner(walletClient);
  const contract = getContract(signer, await findContractWithTrade(String(tradeId), tradeContract));
  if (!contract) throw new Error('Contract not available');

  try {
    console.log('Declining trade:', tradeId);
    
    const tx = await contract.declineTrade(BigInt(tradeId));
    console.log('Decline transaction sent:', tx.hash);
    
    const receipt = await tx.wait();
    console.log('Trade declined successfully');
    
    return receipt.hash;
  } catch (error) {
    console.error('Error declining trade:', error);
    throw error;
  }
}



// Diagnostic function to identify why acceptTrade might fail
export async function diagnoseTradeAcceptance(
  tradeId: string,
  walletClient: any,
  tradeContract?: string
): Promise<{
  canAccept: boolean;
  issues: string[];
}> {
  const signer = await walletClientToSigner(walletClient);
  let contractAddress: string;
  try {
    contractAddress = await findContractWithTrade(String(tradeId), tradeContract);
  } catch (error: any) {
    return { canAccept: false, issues: [error?.message || 'Trade does not exist'] };
  }
  const contract = getContract(signer, contractAddress);
    const userAddress = await signer.getAddress();
    const issues: string[] = [];
    const you = userAddress.toLowerCase();
    const operator = contractAddress;

    if (!contract) {
      issues.push('Contract not available');
      return { canAccept: false, issues };
    }

    try {
    const [id, creator, counterparty, offeredMONAD, requestedMONAD, expiryTime, status, message, createdAt] = await contract.trades(tradeId);

    if (!creator || creator === ethers.ZeroAddress) {
      issues.push('Trade does not exist');
      return { canAccept: false, issues };
    }

    if (counterparty.toLowerCase() !== you) {
      issues.push(`You are not the counterparty for this trade. Expected: ${counterparty}, Got: ${userAddress}`);
    }

    const statusNum = Number(status);
    if (statusNum === 1) {
      issues.push('Trade has already been accepted');
    } else if (statusNum === 2) {
      issues.push('Trade has been cancelled');
    } else if (statusNum === 3) {
      issues.push('Trade has expired');
    } else if (statusNum === 4) {
      issues.push('Trade has been declined');
    }

    const provider = signer.provider;
    const tradeFeeWei = await contract.tradeFee();
    const totalRequired = BigInt(requestedMONAD) + BigInt(tradeFeeWei);
    const userBalance = await provider.getBalance(userAddress);
    if (userBalance < totalRequired) {
      issues.push(ethMissingMessage(userAddress, true));
    }

    const checkSide = async (
      nfts: any[],
      wallet: string,
      isYou: boolean,
      recipient: string
    ) => {
      for (const nft of nfts) {
        const contractAddress = nft.contractAddress || nft[0];
        const tokenId = nft.tokenId ?? nft[1];
        const amount = nft.amount ?? nft[2] ?? BigInt(1);
        const standard = Number(nft.standard ?? nft[3] ?? 0);
        try {
          if (standard === 0) {
            const erc721 = new ethers.Contract(
              contractAddress,
              [
                'function ownerOf(uint256 tokenId) view returns (address)',
                'function getApproved(uint256 tokenId) view returns (address)',
                'function isApprovedForAll(address owner, address operator) view returns (bool)',
                'function transferFrom(address from, address to, uint256 tokenId)',
              ],
              provider
            );
            let owner: string;
            try {
              owner = await erc721.ownerOf(tokenId);
            } catch (error) {
              issues.push(isConfirmedMissingNft(error)
                ? nftMissingMessage(wallet, isYou)
                : `Diagnostic error: Could not verify NFT #${tokenId} ownership. Retry when the network responds.`);
              continue;
            }
            if (owner.toLowerCase() !== wallet.toLowerCase()) {
              issues.push(nftMissingMessage(wallet, isYou));
              continue;
            }
            try {
            const approved = await erc721.getApproved(tokenId);
            const approvedForAll = await erc721.isApprovedForAll(wallet, operator);
            if (
              approved.toLowerCase() !== operator.toLowerCase() &&
              !approvedForAll
            ) {
              issues.push(
                isYou
                  ? 'Approve this collection in your EVM wallet, then confirm the trade.'
                  : `Ask ${wallet.slice(0, 6)}…${wallet.slice(-4)} to approve their collection. Contact your co-trader.`
              );
            } else {
              try {
                await erc721.transferFrom.staticCall(wallet, recipient, tokenId, { from: operator });
              } catch (moveErr) {
                const text = friendlyTradeError(moveErr);
                if (/39646e1a|TemporaryFriendLocked|locked and cannot move|locked for an in-wallet/i.test(String(moveErr) + text)) {
                  issues.push(
                    'This NFT is locked and cannot move in-wallet. Wait until it unlocks, then send a new Escrow offer.'
                  );
                }
              }
            }
            } catch {
              issues.push(
                isYou
                  ? 'Approve this collection in your EVM wallet, then confirm the trade.'
                  : `Ask ${wallet.slice(0, 6)}…${wallet.slice(-4)} to approve their collection. Contact your co-trader.`
              );
            }
          } else {
            const erc1155 = new ethers.Contract(
              contractAddress,
              [
                'function balanceOf(address account, uint256 id) view returns (uint256)',
                'function isApprovedForAll(address owner, address operator) view returns (bool)',
              ],
              provider
            );
            const balance = await erc1155.balanceOf(wallet, tokenId);
            if (balance < amount) {
              issues.push(nftMissingMessage(wallet, isYou));
              continue;
            }
            try {
            const approvedForAll = await erc1155.isApprovedForAll(wallet, operator);
            if (!approvedForAll) {
              issues.push(
                isYou
                  ? 'Approve this collection in your EVM wallet, then confirm the trade.'
                  : `Ask ${wallet.slice(0, 6)}…${wallet.slice(-4)} to approve their collection. Contact your co-trader.`
              );
            }
            } catch {
              issues.push(
                isYou
                  ? 'Approve this collection in your EVM wallet, then confirm the trade.'
                  : `Ask ${wallet.slice(0, 6)}…${wallet.slice(-4)} to approve their collection. Contact your co-trader.`
              );
            }
          }
        } catch {
          issues.push(`Diagnostic error: Could not verify NFT #${tokenId}. Retry when the network responds.`);
        }
      }
    };

    const offeredNFTs = await contract.getOfferedNFTs(tradeId);
    const requestedNFTs = await contract.getRequestedNFTs(tradeId);
    await checkSide(offeredNFTs, creator, creator.toLowerCase() === you, counterparty);
    await checkSide(requestedNFTs, counterparty, counterparty.toLowerCase() === you, creator);

    return {
      canAccept: issues.length === 0,
      issues,
    };
  } catch (error: any) {
    console.error('Error in trade diagnostics:', error);
    issues.push(`Diagnostic error: ${error.message}`);
    return { canAccept: false, issues };
  }
}

// Approve NFTs for trade acceptance
export async function approveNFTsForTradeAcceptance(
  tradeId: string,
  walletClient: any,
  tradeContract?: string
): Promise<void> {
  const signer = await walletClientToSigner(walletClient);
  const operator = await findContractWithTrade(String(tradeId), tradeContract);
  const contract = getContract(signer, operator);
  if (!contract) throw new Error('Contract not available');

  try {
    // Get requested NFTs that need approval
    const requestedNFTs = await contract.getRequestedNFTs(tradeId);
    
    for (let i = 0; i < requestedNFTs.length; i++) {
      const nft = requestedNFTs[i];
      const contractAddress = nft.contractAddress;
      const tokenId = nft.tokenId;
      const standard = nft.standard;

      if (standard === 0) { // ERC721
        await approveERC721ForTrading(contractAddress, tokenId.toString(), walletClient, operator);
      } else if (standard === 1) { // ERC1155
        await approveERC1155ForTrading(contractAddress, walletClient, operator);
      }
    }
    
    console.log('✅ All NFT approvals completed');
  } catch (error) {
    console.error('❌ NFT approval failed:', error);
    throw error;
  }
}

// Helper function to approve ERC721 NFT for trading
export async function approveERC721ForTrading(
  contractAddress: string,
  tokenId: string,
  walletClient: any,
  operatorAddress?: string
): Promise<void> {
  const signer = await walletClientToSigner(walletClient);
  const operator = operatorAddress || CONTRACT_CONFIG.address;
  
  console.log('🔓 Approving ERC721 NFT for trading...');
  console.log(`Contract: ${contractAddress}`);
  console.log(`Token ID: ${tokenId}`);
  console.log(`Trading Contract: ${operator}`);
  
  const erc721Contract = new ethers.Contract(
    contractAddress,
    [
      'function approve(address to, uint256 tokenId)',
      'function setApprovalForAll(address operator, bool approved)',
      'function getApproved(uint256 tokenId) view returns (address)',
      'function isApprovedForAll(address owner, address operator) view returns (bool)'
    ],
    signer
  );
  
  try {
    const userAddress = await signer.getAddress();
    let alreadyApproved = false;

    try {
      alreadyApproved = Boolean(await erc721Contract.isApprovedForAll(userAddress, operator));
    } catch {
      alreadyApproved = false;
    }

    if (!alreadyApproved) {
      try {
        const currentApproved = await erc721Contract.getApproved(tokenId);
        alreadyApproved = String(currentApproved).toLowerCase() === operator.toLowerCase();
      } catch {
        // Some collections return empty data for getApproved. setApprovalForAll is enough.
      }
    }

    if (alreadyApproved) {
      return;
    }

    const tx = await erc721Contract.setApprovalForAll(operator, true);
    await tx.wait();
  } catch (error: any) {
    throw new Error(
      /BAD_DATA|getApproved|could not decode/i.test(String(error?.message || error))
        ? 'Approve this collection in your wallet. If the prompt did not appear, try Escrow for this offer.'
        : `Could not approve this collection: ${error?.shortMessage || error?.message || 'wallet rejected or failed'}`
    );
  }
}

// Helper function to approve ERC1155 NFT for trading  
export async function approveERC1155ForTrading(
  contractAddress: string,
  walletClient: any,
  operatorAddress?: string
): Promise<void> {
  const operator = operatorAddress || CONTRACT_CONFIG.address;
  console.log(`🔓 Approving ERC1155 collection: ${contractAddress}`);
  
  const signer = await walletClientToSigner(walletClient);
  
  // First, validate that the contract exists and has the required functions
  try {
    const code = await optimalProvider.getCode(contractAddress);
    if (code === '0x') {
      throw new Error(`Contract does not exist at address: ${contractAddress}`);
    }
  } catch (error) {
    console.error('❌ Contract validation failed:', error);
    throw new Error(`Invalid contract address: ${contractAddress}`);
  }

  const erc1155Contract = new ethers.Contract(
    contractAddress,
    [
      'function setApprovalForAll(address operator, bool approved)',
      'function isApprovedForAll(address account, address operator) view returns (bool)'
    ],
    signer
  );
  
  try {
    // Check current approval status
    const userAddress = await signer.getAddress();
    
    let isApproved = false;
    try {
      isApproved = await erc1155Contract.isApprovedForAll(userAddress, operator);
    } catch (approvalCheckError) {
      console.warn('⚠️ Could not check approval status, proceeding with approval attempt:', approvalCheckError.message);
      // Continue with approval attempt even if we can't check current status
    }
    
    if (isApproved) {
      console.log('✅ ERC1155 collection is already approved');
      return;
    }
    
    console.log('📝 Calling setApprovalForAll...');
    const tx = await erc1155Contract.setApprovalForAll(operator, true);
    console.log('⏳ Transaction sent:', tx.hash);
    
    await tx.wait();
    console.log('✅ ERC1155 approval successful!');
    
  } catch (error) {
    console.error('❌ Failed to approve ERC1155:', error);
    
    // Provide more helpful error messages
    if (error.message?.includes('could not decode result data')) {
      throw new Error(`This contract doesn't properly implement ERC1155 interface. Contract: ${contractAddress}`);
    } else if (error.message?.includes('user rejected')) {
      throw new Error('Transaction was rejected by user');
    } else if (error.message?.includes('insufficient funds')) {
      throw new Error('Insufficient funds for gas fees');
    } else {
      throw new Error(`Failed to approve ERC1155 collection: ${error.message}`);
    }
  }
}

// Batch approval function for multiple NFTs
export async function batchApproveNFTsForTrading(
  nfts: Array<{ contractAddress: string; tokenId: string; standard: 'ERC721' | 'ERC1155' }>,
  walletClient: any,
  progressCallback?: (message: string, current: number, total: number) => void
): Promise<void> {
  console.log(`🔓 Starting batch approval for ${nfts.length} NFTs...`);
  
  const uniqueCollections = new Map<string, 'ERC721' | 'ERC1155'>();
  
  // Group by collection to avoid duplicate approvals
  nfts.forEach(nft => {
    uniqueCollections.set(nft.contractAddress, nft.standard);
  });
  
  console.log(`📦 Found ${uniqueCollections.size} unique collections to approve`);
  
  let current = 0;
  const total = uniqueCollections.size;
  
  for (const [contractAddress, standard] of uniqueCollections) {
    current++;
    
    const message = `Approving ${standard} collection ${current}/${total}: ${contractAddress}`;
    console.log(message);
    
    if (progressCallback) {
      progressCallback(message, current, total);
    }
    
    try {
      if (standard === 'ERC721') {
        // For ERC721, we just need setApprovalForAll once per collection
        const signer = await walletClientToSigner(walletClient);
        const erc721Contract = new ethers.Contract(
          contractAddress,
          ['function setApprovalForAll(address operator, bool approved)'],
          signer
        );
        const tx = await erc721Contract.setApprovalForAll(CONTRACT_CONFIG.address, true);
        await tx.wait();
      } else {
        await approveERC1155ForTrading(contractAddress, walletClient);
      }
      
      console.log(`✅ Approved ${standard} collection: ${contractAddress}`);
      
    } catch (error) {
      console.error(`❌ Failed to approve ${standard} collection ${contractAddress}:`, error);
      throw new Error(`Failed to approve ${standard} collection ${contractAddress}: ${error.message}`);
    }
  }
  
  console.log('🎉 All NFT collections approved successfully!');
}

// Function to check if an NFT is approved for trading
export async function isNFTApprovedForTrading(
  contractAddress: string,
  tokenId: string,
  userAddress: string,
  standard: 'ERC721' | 'ERC1155',
  operatorAddress?: string
): Promise<boolean> {
  const operator = operatorAddress || CONTRACT_CONFIG.address;
  // Use standard RPC for contract calls
  const provider = optimalProvider.getProvider();
  
  try {
    if (standard === 'ERC721') {
      const erc721Contract = new ethers.Contract(
        contractAddress,
        [
          'function getApproved(uint256 tokenId) view returns (address)',
          'function isApprovedForAll(address owner, address operator) view returns (bool)'
        ],
        provider
      );
      
      const approvedAddress = await erc721Contract.getApproved(tokenId);
      const isApprovedForAll = await erc721Contract.isApprovedForAll(userAddress, operator);
      
      return (
        approvedAddress.toLowerCase() === operator.toLowerCase() ||
        isApprovedForAll
      );
      
    } else { // ERC1155
      // First validate that the contract exists
      const code = await optimalProvider.getCode(contractAddress);
      if (code === '0x') {
        console.warn(`⚠️ Contract does not exist at address: ${contractAddress}`);
        return false;
      }
      
      const erc1155Contract = new ethers.Contract(
        contractAddress,
        ['function isApprovedForAll(address account, address operator) view returns (bool)'],
        provider
      );
      
      try {
        return await erc1155Contract.isApprovedForAll(userAddress, operator);
      } catch (approvalError) {
        if (approvalError.message?.includes('could not decode result data')) {
          console.warn(`⚠️ Contract ${contractAddress} doesn't properly implement ERC1155 interface`);
          return false;
        }
        throw approvalError; // Re-throw other errors
      }
    }
    
  } catch (error) {
    console.error('Error checking NFT approval:', error);
    return false;
  }
}

// Legacy function aliases for backward compatibility
export async function checkNFTApproval(
  contractAddress: string,
  userAddress: string,
  standard: 'ERC721' | 'ERC1155'
): Promise<boolean> {
  // Use the new function with a dummy tokenId for ERC1155 (not used in ERC1155 check)
  return isNFTApprovedForTrading(contractAddress, '0', userAddress, standard);
}

// Legacy function alias for backward compatibility
export async function approveNFTForTrading(
  contractAddress: string,
  standard: 'ERC721' | 'ERC1155',
  walletClient: any
): Promise<void> {
  if (standard === 'ERC721') {
    // For ERC721, we'll use setApprovalForAll which covers all tokens
    const signer = await walletClientToSigner(walletClient);
    const erc721Contract = new ethers.Contract(
      contractAddress,
      ['function setApprovalForAll(address operator, bool approved)'],
      signer
    );
    const tx = await erc721Contract.setApprovalForAll(CONTRACT_CONFIG.address, true);
    await tx.wait();
  } else {
    await approveERC1155ForTrading(contractAddress, walletClient);
  }
}

// Get required approvals for a trade (for manual approval interface)
export async function getRequiredApprovalsForTrade(
  tradeId: string,
  walletClient: any,
  isAcceptance: boolean = true,
  tradeContract?: string
): Promise<Array<{
  contractAddress: string;
  tokenId: string;
  amount: string;
  standard: 'ERC721' | 'ERC1155';
}>> {
  try {
    const signer = await walletClientToSigner(walletClient);
    const userAddress = await signer.getAddress();
    const provider = new ethers.JsonRpcProvider(getOptimalProvider().standardRpc);
    const operator = tradeContract || await findContractWithTrade(String(tradeId));
    const contract = new ethers.Contract(operator, CONTRACT_CONFIG.abi, provider);
    
    // For acceptance, we need approvals for requested NFTs
    // For creation, we need approvals for offered NFTs
    const nfts = isAcceptance 
      ? await contract.getRequestedNFTs(tradeId)
      : await contract.getOfferedNFTs(tradeId);
    
    // Check which NFTs actually need approval
    const unapprovedNFTs = [];
    
    for (const nft of nfts) {
      const standard = nft.standard === 0 ? 'ERC721' : 'ERC1155';
      const isApproved = await isNFTApprovedForTrading(
        nft.contractAddress,
        nft.tokenId.toString(),
        userAddress,
        standard as 'ERC721' | 'ERC1155',
        operator
      );
      
      if (!isApproved) {
        unapprovedNFTs.push({
          contractAddress: nft.contractAddress,
          tokenId: nft.tokenId.toString(),
          amount: nft.amount.toString(),
          standard: standard as 'ERC721' | 'ERC1155',
        });
      }
    }
    
    return unapprovedNFTs;
  } catch (error) {
    console.error('Error getting required approvals:', error);
    return [];
  }
}

export async function getTrades(
  filters: {
    creator?: string;
    responder?: string;
    status?: number[];
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ trades: TradeData[]; total: number; hasMore: boolean }> {
  try {
    // Use HyperRPC for getLogs - this will be much faster!
    const provider = optimalProvider.getProvider('eth_getLogs');
    const contract = new ethers.Contract(CONTRACT_CONFIG.address, CONTRACT_CONFIG.abi, provider);
    
    // Build filter for TradeCreated events
    const filter = contract.filters.TradeCreated();
    
    // Get events using HyperRPC (5x faster!)
    console.log('🚀 Fetching trade events with HyperRPC...');
    const events = await contract.queryFilter(filter, -10000); // Last 10k blocks
    
    console.log(`📊 Found ${events.length} total trade events`);
    
    // Process events and apply filters
    let trades: TradeData[] = [];
    
    for (const event of events.reverse()) { // Most recent first
      try {
        // Type cast to EventLog to access args property
        const eventLog = event as ethers.EventLog;
        const tradeId = eventLog.args?.[0]?.toString();
        if (!tradeId) continue;
        
        const trade = await getTrade(tradeId);
        if (!trade) continue;
        
        // Apply filters
        if (filters.creator && trade.creator.toLowerCase() !== filters.creator.toLowerCase()) continue;
        if (filters.responder && trade.responder !== ethers.ZeroAddress && 
            trade.responder.toLowerCase() !== filters.responder.toLowerCase()) continue;
        if (filters.status && !filters.status.includes(trade.status)) continue;
        
        trades.push(trade);
        
        // Apply limit
        if (filters.limit && trades.length >= filters.limit) break;
      } catch (error) {
        console.warn(`Failed to process trade event:`, error);
        continue;
      }
    }
    
    // Apply offset
    const offset = filters.offset || 0;
    const paginatedTrades = trades.slice(offset, offset + (filters.limit || trades.length));
    
    console.log(`✅ Processed ${paginatedTrades.length} trades with filters applied`);
    
    return {
      trades: paginatedTrades,
      total: trades.length,
      hasMore: offset + paginatedTrades.length < trades.length
    };
    
  } catch (error) {
    console.error('❌ Error fetching trades:', error);
    return { trades: [], total: 0, hasMore: false };
  }
}

export async function claimAssets(tradeId: string | number, walletClient: any): Promise<string> {
  if (!walletClient) throw new Error('Wallet client not connected');

  const signer = await walletClientToSigner(walletClient);
  const contract = getContract(signer);
  if (!contract) throw new Error('Contract not available');

  // Ensure the contract actually exposes claimAssets(uint256)
  const signature = 'claimAssets(uint256)';
  if (!(signature in (contract.interface as any).functions)) {
    throw new Error('The connected trading contract does not support manual asset claiming. Assets are automatically returned on decline / cancel / expire.');
  }

  console.log('📡 Calling claimAssets on contract for trade', tradeId);
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - dynamic function access verified above
  const tx = await contract.claimAssets(BigInt(tradeId));
  console.log('✅ Transaction sent:', tx.hash);
  const receipt = await tx.wait();
  console.log('✅ Transaction confirmed');
  return receipt.hash;
}

const CHAIN_TRADE_STATUS: Record<number, 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired'> = {
  0: 'pending',
  1: 'accepted',
  2: 'cancelled',
  3: 'expired',
  4: 'declined',
};

export type OnChainTradeProposal = {
  id: string;
  blockchainTradeId: string;
  tradeContract?: string;
  from: string;
  to: string;
  offer: Array<{
    contract: string;
    tokenId: string;
    image?: string;
    name?: string;
    amount?: string;
    standard?: string;
  }>;
  requested: Array<{
    contract: string;
    tokenId: string;
    image?: string;
    name?: string;
    amount?: string;
    standard?: string;
  }>;
  offeredMonad: string;
  requestedMonad: string;
  offeredChog?: string;
  requestedChog?: string;
  message: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired' | 'incomplete';
  createdAt: Date;
  expiresAt?: Date;
};

async function metadataForNft(contractAddress: string, tokenId: string) {
  const toGatewayUrl = (value?: string) => {
    if (!value) return '';
    if (!value.startsWith('ipfs://')) return value;
    const cidAndPath = value.replace(/^ipfs:\/\/(?:ipfs\/)?/, '');
    return `https://ipfs.io/ipfs/${cidAndPath}`;
  };

  try {
    const { getTokenURI } = await import('@/services/verifiedNFTChecker');
    const tokenURI = await getTokenURI(contractAddress, tokenId);
    if (!tokenURI) return { name: `#${tokenId}`, image: '' };
    let json: { name?: string; image?: string; image_url?: string } | null = null;
    if (tokenURI.startsWith('data:')) {
      const encoded = tokenURI.split(',')[1] || '';
      const raw =
        typeof Buffer !== 'undefined'
          ? Buffer.from(encoded, 'base64').toString('utf-8')
          : atob(encoded);
      json = JSON.parse(raw);
    } else if (tokenURI.startsWith('http') || tokenURI.startsWith('ipfs://')) {
      const url = toGatewayUrl(tokenURI);
      const res = await fetch(url);
      if (res.ok) json = await res.json();
    }
    return {
      name: json?.name || `#${tokenId}`,
      image: toGatewayUrl(json?.image || json?.image_url),
    };
  } catch {
    return { name: `#${tokenId}`, image: '' };
  }
}

async function mapChainNfts(nfts: Array<{ contractAddress: string; tokenId: bigint; amount: bigint; standard: bigint }>) {
  return Promise.all(
    (nfts || []).map(async (nft) => {
      const tokenId = nft.tokenId.toString();
      const meta = await metadataForNft(nft.contractAddress, tokenId);
      return {
        contract: nft.contractAddress,
        tokenId,
        name: meta.name,
        image: meta.image,
        amount: nft.amount.toString(),
        standard: Number(nft.standard) === 1 ? 'ERC1155' : 'ERC721',
      };
    })
  );
}

async function readOnChainTrade(
  tradeId: string,
  contractAddress = getTradeContractAddress()
): Promise<{ trade: OnChainTradeProposal | null; verified: boolean }> {
  if (!isAllowedTradeContract(contractAddress)) return { trade: null, verified: true };
  const provider = optimalProvider.getProvider();
  const contract = new ethers.Contract(contractAddress, CONTRACT_CONFIG.abi, provider);
  try {
    const trade = await contract.trades(BigInt(tradeId));
    const creator = trade.creator || trade[1];
    if (!creator || creator === ethers.ZeroAddress) return { trade: null, verified: true };
    const [offeredNFTs, requestedNFTs] = await Promise.all([
      contract.getOfferedNFTs(BigInt(tradeId)),
      contract.getRequestedNFTs(BigInt(tradeId)),
    ]);
    const statusNum = Number(trade.status ?? trade[6]);
    const createdAt = Number(trade.createdAt ?? trade[8]) * 1000;
    const expiresAtMs = Number(trade.expiryTime ?? trade[5]) * 1000;
    const status =
      statusNum === 0 && expiresAtMs && Date.now() > expiresAtMs
        ? 'expired'
        : CHAIN_TRADE_STATUS[statusNum] || 'pending';
    return {
      trade: {
        id: `${contractAddress.toLowerCase()}-${tradeId}`,
        blockchainTradeId: String(tradeId),
        tradeContract: contractAddress,
        from: String(creator),
        to: String(trade.counterparty || trade[2]),
        offer: await mapChainNfts(offeredNFTs),
        requested: await mapChainNfts(requestedNFTs),
        offeredMonad: ethers.formatEther(trade.offeredETH ?? trade[3] ?? BigInt(0)),
        requestedMonad: ethers.formatEther(trade.requestedETH ?? trade[4] ?? BigInt(0)),
        offeredChog: ethers.formatEther(trade.offeredChog ?? BigInt(0)),
        requestedChog: ethers.formatEther(trade.requestedChog ?? BigInt(0)),
        message: trade.message || trade[7] || '',
        status,
        createdAt: new Date(createdAt),
        expiresAt: expiresAtMs ? new Date(expiresAtMs) : undefined,
      },
      verified: true,
    };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (!/failed to fetch|network|timeout/i.test(text)) {
      console.warn('Skipped on-chain trade', tradeId);
    }
    return { trade: null, verified: false };
  }
}

export async function getOnChainTrade(
  tradeId: string,
  contractAddress = getTradeContractAddress()
): Promise<OnChainTradeProposal | null> {
  return (await readOnChainTrade(tradeId, contractAddress)).trade;
}

export async function getIncomingOfferCount(userAddress: string): Promise<number> {
  const provider = optimalProvider.getProvider();
  let extras: string[] = [];
  try {
    const { collection, getDocs, query, where } = await import('firebase/firestore');
    const { db } = await import('@/lib/firebase');
    const normalized = userAddress.toLowerCase();
    const [created, received] = await Promise.all([
      getDocs(query(collection(db, 'trades'), where('from', '==', normalized))),
      getDocs(query(collection(db, 'trades'), where('to', '==', normalized))),
    ]);
    extras = [...created.docs, ...received.docs]
      .map((docSnap) => docSnap.data()?.tradeContract)
      .filter((addr): addr is string => typeof addr === 'string' && Boolean(addr))
      .filter((addr) => addr.toLowerCase() !== LEGACY_ESCROW_TRADE_ADDRESS);
  } catch {
    extras = [];
  }
  const addresses = await listTradeContracts(extras);
  const { getEscrowAddress } = await import('@/lib/escrow');
  const escrowAddr = (getEscrowAddress() || '').toLowerCase();
  let count = 0;
  for (const contractAddress of addresses) {
    if (escrowAddr && contractAddress.toLowerCase() === escrowAddr) continue;
    const contract = new ethers.Contract(contractAddress, CONTRACT_CONFIG.abi, provider);
    const received = await contract.getUserReceivedTrades(userAddress);
    const statuses = await Promise.all(
      received.map(async (id: bigint) => {
        try {
          const trade = await contract.trades(id);
          return Number(trade.status ?? trade[6]);
        } catch {
          return -1;
        }
      })
    );
    if (statuses.some((status) => status < 0)) {
      throw new Error('Could not verify incoming offers');
    }
    count += statuses.filter((status) => status === 0).length;
  }
  return count;
}

function deferredCacheKey(wallet: string) {
  return `etaswap-deferred-eth:${wallet.toLowerCase()}`;
}

export function readCachedDeferredEth(wallet: string): bigint | null {
  if (typeof window === 'undefined' || !wallet) return null;
  try {
    const raw = window.localStorage.getItem(deferredCacheKey(wallet));
    if (raw == null || raw === '') return null;
    return BigInt(raw);
  } catch {
    return null;
  }
}

export function writeCachedDeferredEth(wallet: string, amount: bigint) {
  if (typeof window === 'undefined' || !wallet) return;
  window.localStorage.setItem(deferredCacheKey(wallet), amount.toString());
}

export async function getDeferredEth(walletAddress: string): Promise<bigint> {
  const address = getTradeContractAddress();
  if (!isAllowedTradeContract(address) || !walletAddress) {
    throw new Error('Trade contract is not published.');
  }
  const provider = optimalProvider.getProvider();
  const contract = new ethers.Contract(address, CONTRACT_CONFIG.abi, provider);
  return BigInt(await contract.deferredEth(walletAddress));
}

export async function withdrawDeferredEth(walletClient: any): Promise<string> {
  const address = getTradeContractAddress();
  if (!isAllowedTradeContract(address)) {
    throw new Error('Trade contract is not published.');
  }
  const signer = await walletClientToSigner(walletClient);
  const contract = getContract(signer, address);
  if (!contract) throw new Error('Contract not available');
  const tx = await contract.withdrawDeferredEth();
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function getDeferredChog(walletAddress: string): Promise<bigint> {
  const address = getTradeContractAddress();
  if (!isAllowedTradeContract(address) || !walletAddress) {
    throw new Error('Trade contract is not published.');
  }
  const provider = optimalProvider.getProvider();
  const contract = new ethers.Contract(address, CONTRACT_CONFIG.abi, provider);
  try {
    return BigInt(await contract.deferredChog(walletAddress));
  } catch {
    return 0n;
  }
}

export async function withdrawDeferredChog(walletClient: any): Promise<string> {
  const address = getTradeContractAddress();
  if (!isAllowedTradeContract(address)) {
    throw new Error('Trade contract is not published.');
  }
  const signer = await walletClientToSigner(walletClient);
  const contract = getContract(signer, address);
  if (!contract) throw new Error('Contract not available');
  const tx = await contract.withdrawDeferredChog();
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function getOnChainUserTrades(
  userAddress: string,
  extraAddresses: string[] = []
): Promise<{ trades: OnChainTradeProposal[]; complete: boolean }> {
  const { getEscrowAddress } = await import('@/lib/escrow');
  const escrowAddr = (getEscrowAddress() || '').toLowerCase();
  const addresses = (await listTradeContracts(extraAddresses)).filter(
    (addr) => addr.toLowerCase() !== escrowAddr
  );
  const you = userAddress.toLowerCase();
  const batches = await Promise.all(
    addresses.map(async (contractAddress) => {
      const provider = optimalProvider.getProvider();
      const contract = new ethers.Contract(contractAddress, CONTRACT_CONFIG.abi, provider);
      try {
        const [created, received] = await Promise.all([
          contract.getUserCreatedTrades(userAddress),
          contract.getUserReceivedTrades(userAddress),
        ]);
        const ids = [...new Set([...created, ...received].map((id: bigint) => id.toString()))];
        const reads = await Promise.all(ids.map((id) => readOnChainTrade(id, contractAddress)));
        return {
          trades: reads
            .map((row) => row.trade)
            .filter((trade): trade is OnChainTradeProposal => Boolean(trade)),
          complete: reads.every((row) => row.verified),
        };
      } catch {
        try {
          const createdTopic = contract.interface.getEvent('TradeCreated')?.topicHash;
          if (!createdTopic) return { trades: [] as OnChainTradeProposal[], complete: false };
          const latest = await provider.getBlockNumber();
          const logs = await provider.getLogs({
            address: contractAddress,
            topics: [createdTopic],
            fromBlock: Math.max(0, latest - 80_000),
            toBlock: 'latest',
          });
          const ids = new Set<string>();
          for (const log of logs) {
            try {
              const parsed = contract.interface.parseLog(log);
              const creator = String(parsed?.args?.creator || '').toLowerCase();
              const counterparty = String(parsed?.args?.counterparty || '').toLowerCase();
              if (creator === you || counterparty === you) {
                ids.add(parsed?.args?.tradeId?.toString());
              }
            } catch {
              continue;
            }
          }
          const reads = await Promise.all([...ids].map((id) => readOnChainTrade(id, contractAddress)));
          return {
            trades: reads
              .map((row) => row.trade)
              .filter((trade): trade is OnChainTradeProposal => Boolean(trade)),
            complete: false,
          };
        } catch {
          return { trades: [] as OnChainTradeProposal[], complete: false };
        }
      }
    })
  );
  let escrowTrades: OnChainTradeProposal[] = [];
  let escrowComplete = true;
  try {
    const { getEscrowOnChainTrade } = await import('@/services/escrow');
    if (escrowAddr) {
      const provider = optimalProvider.getProvider();
      const EscrowArtifact = (await import('@/lib/abis/EtaSwapEscrowV1.json')).default;
      const contract = new ethers.Contract(escrowAddr, EscrowArtifact.abi, provider);
      const createdTopic = contract.interface.getEvent('Created')?.topicHash;
      if (createdTopic) {
        const latest = await provider.getBlockNumber();
        const logs = await provider.getLogs({
          address: escrowAddr,
          topics: [createdTopic],
          fromBlock: Math.max(0, latest - 80_000),
          toBlock: 'latest',
        });
        const ids = new Set<string>();
        for (const log of logs) {
          try {
            const parsed = contract.interface.parseLog(log);
            const creator = String(parsed?.args?.creator || parsed?.args?.[1] || '').toLowerCase();
            const counterparty = String(parsed?.args?.counterparty || parsed?.args?.[2] || '').toLowerCase();
            if (creator === you || counterparty === you) {
              ids.add((parsed?.args?.tradeId || parsed?.args?.[0])?.toString());
            }
          } catch {
            continue;
          }
        }
        const rows = await Promise.all([...ids].map((id) => getEscrowOnChainTrade(id, escrowAddr)));
        escrowTrades = rows.filter(Boolean) as unknown as OnChainTradeProposal[];
        escrowComplete = rows.every(Boolean);
      }
    }
  } catch {
    escrowTrades = [];
    escrowComplete = !escrowAddr;
  }
  const trades = [...batches.flatMap((batch) => batch.trades), ...escrowTrades].sort(
    (a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0)
  );
  return {
    trades,
    complete: batches.every((batch) => batch.complete) && escrowComplete,
  };
}

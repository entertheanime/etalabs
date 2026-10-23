import { formatEther } from 'viem';
import { getTradeContractAddress } from '@/lib/contracts';
import { getEscrowAddress } from '@/lib/escrow';
import { chainForNetwork, runtimeNetwork } from '@/lib/networkPref';

const FEE_ABI = [
  { type: 'function', name: 'tradeFee', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  {
    type: 'function',
    name: 'feeFor',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export async function readProtocolFee(
  publicClient: { readContract: (args: any) => Promise<unknown> } | undefined,
  mode: 'stay-in-wallet' | 'escrow',
  account?: string
): Promise<bigint> {
  const address = (mode === 'escrow' ? getEscrowAddress() : getTradeContractAddress()) as `0x${string}`;
  if (!publicClient || !address) return 0n;
  if (account) {
    try {
      return (await publicClient.readContract({
        address,
        abi: FEE_ABI,
        functionName: 'feeFor',
        args: [account],
      })) as bigint;
    } catch {
      /* older programs have no feeFor */
    }
  }
  try {
    return (await publicClient.readContract({
      address,
      abi: FEE_ABI,
      functionName: 'tradeFee',
    })) as bigint;
  } catch {
    return 0n;
  }
}

export function formatProtocolFee(fee: bigint) {
  return `${formatEther(fee)} ${chainForNetwork(runtimeNetwork()).nativeCurrency.symbol}`;
}

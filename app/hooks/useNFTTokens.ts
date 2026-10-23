import { useQuery } from '@tanstack/react-query';
import { getNFTsForCollection } from '@/services/nft';

export function useNFTTokens(walletAddress: string, collectionId: string) {
  return useQuery({
    queryKey: ['nft-tokens', walletAddress, collectionId],
    queryFn: () => getNFTsForCollection(walletAddress, collectionId),
    enabled: !!(walletAddress && collectionId), // Only run if both exist
    staleTime: 5 * 60 * 1000, // Data is fresh for 5 minutes
    cacheTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    refetchOnWindowFocus: false, // Don't refetch when window gains focus
    refetchOnMount: false, // Don't refetch on component mount if data exists
  });
} 
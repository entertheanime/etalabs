'use client'

import '@rainbow-me/rainbowkit/styles.css'
import { connectorsForWallets, RainbowKitProvider, darkTheme, lightTheme, Theme } from '@rainbow-me/rainbowkit'
import {
  trustWallet,
  coinbaseWallet,
  braveWallet,
  ledgerWallet,
  okxWallet,
  rainbowWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets'
import { configureChains, createConfig, WagmiConfig } from 'wagmi'
import { publicProvider } from 'wagmi/providers/public'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactNode, useEffect } from 'react'
import { useTheme } from '../context/ThemeContext'
import { SWITCHABLE_CHAINS } from '@/lib/chain'
import { backpackWallet, etaswapMetaMaskWallet, etaswapRabbyWallet, hahaWallet, warmInjectedWallets } from '@/lib/wallet'

if (typeof window !== 'undefined') {
  warmInjectedWallets()
}

const { chains, publicClient } = configureChains(
  [...SWITCHABLE_CHAINS],
  [publicProvider()]
)

console.log('🔗 WalletProvider: Chains configured:', chains)
console.log('🔗 WalletProvider: Public client configured:', !!publicClient)

const projectId = '63e89cb686fa4a8f6537b92f85163637'

const connectors = connectorsForWallets([
  {
    groupName: 'Popular',
    wallets: [
      etaswapMetaMaskWallet({ chains, projectId }),
      etaswapRabbyWallet({ chains }),
      backpackWallet({ chains }),
      hahaWallet({ chains }),
      walletConnectWallet({ projectId, chains }),
      coinbaseWallet({ appName: 'etatrade', chains }),
      rainbowWallet({ projectId, chains }),
      trustWallet({ projectId, chains }),
    ],
  },
  {
    groupName: 'Other',
    wallets: [
      okxWallet({ projectId, chains }),
      braveWallet({ chains }),
      ledgerWallet({ projectId, chains }),
    ],
  },
])

const wagmiConfig = createConfig({
  autoConnect: true,
  connectors,
  publicClient
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
})

function RainbowKitProviderWithTheme({ children }: { children: ReactNode }) {
  const { theme } = useTheme()
  
  const createGlassTheme = (isDark: boolean): Theme => {
    const base = isDark
      ? darkTheme({
          accentColor: '#ff453a',
          accentColorForeground: 'white',
          borderRadius: 'large',
          fontStack: 'system',
          overlayBlur: 'small',
        })
      : lightTheme({
          accentColor: '#ff453a',
          accentColorForeground: 'white',
          borderRadius: 'medium',
          fontStack: 'system',
          overlayBlur: 'small',
        });

    return {
      ...base,
      colors: {
        ...base.colors,
        // Make outer background transparent to avoid double-glass effect on mobile
        connectButtonBackground: 'transparent',
        connectButtonBackgroundError: isDark ? 'rgba(255,0,0,0.15)' : 'rgba(255,0,0,0.1)',
        connectButtonInnerBackground: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.55)',
        actionButtonBorder: 'transparent',
        actionButtonBorderMobile: 'transparent',
        menuItemBackground: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
        modalBackground: isDark ? '#0b0b0c' : 'rgba(255,255,255,0.96)',
        modalBorder: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
        generalBorderDim: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)',
      },
      shadows: {
        ...base.shadows,
        connectButton: '0 4px 20px rgba(0,0,0,0.15)',
      },
    } as Theme;
  };

  const rainbowKitTheme = createGlassTheme(theme === 'dark');

  return (
    <RainbowKitProvider chains={chains} theme={rainbowKitTheme} modalSize="compact">
      {children}
    </RainbowKitProvider>
  )
}

export default function RainbowKitProviders({ children }: { children: ReactNode }) {
  useEffect(() => {
    warmInjectedWallets()
  }, [])
  return (
    <WagmiConfig config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProviderWithTheme>
          {children}
        </RainbowKitProviderWithTheme>
      </QueryClientProvider>
    </WagmiConfig>
  )
} 

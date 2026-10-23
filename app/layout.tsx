import './globals.css'
import { Providers } from './providers'
import ErrorBoundary from './components/ErrorBoundary'
import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { ThemeProvider } from './context/ThemeContext'
import AppToaster from './components/AppToaster'
import { resolveNetwork } from '@/lib/networkPref'

export const metadata = {
  title: 'ETA',
  description:
    'Peer-to-peer NFT trades on Robinhood Chain. Two wallets, one board, NFTs stay until accept.',
  icons: {
    icon: '/favicon.svg?v=red-swap-square',
  },
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookieStore = await cookies()
  const initialNetwork = resolveNetwork(cookieStore.get('etaswap-network')?.value)
  return (
    <html lang="en" className="dark" style={{ colorScheme: 'dark' }} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){document.documentElement.classList.remove('light');document.documentElement.classList.add('dark');function s(){document.querySelectorAll('[bis_skin_checked]').forEach(function(n){n.removeAttribute('bis_skin_checked')})}s();try{var o=new MutationObserver(s);o.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['bis_skin_checked']});setTimeout(function(){o.disconnect()},8000)}catch(e){}})();`,
          }}
        />
      </head>
      <body className="font-sans antialiased bg-[var(--page)] text-ink" suppressHydrationWarning>
        <ThemeProvider>
          <Suspense fallback={<div>Loading...</div>}>
            <Providers initialNetwork={initialNetwork}>
              <ErrorBoundary>
                {children}
              </ErrorBoundary>
            </Providers>
          </Suspense>
          <AppToaster />
        </ThemeProvider>
      </body>
    </html>
  )
}

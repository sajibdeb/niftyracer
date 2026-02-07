import { PrivyProvider } from '@privy-io/react-auth'
import { base } from 'viem/chains'

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID

export function PrivyProviderWrapper({ children }: { children: React.ReactNode }) {
  if (!PRIVY_APP_ID) {
    console.error('Missing VITE_PRIVY_APP_ID environment variable')
    return <>{children}</>
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#00ffff',
          logo: '/img/logo.png',
        },
        loginMethods: ['wallet'],
        defaultChain: base,
        supportedChains: [base],
        // Disable embedded wallets - users must connect external wallet
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'off',
          },
        },
      }}
    >
      {children}
    </PrivyProvider>
  )
}
/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      { source: '/swap', destination: '/trade', permanent: false },
      { source: '/trades', destination: '/activity', permanent: false },
    ];
  },
  // API keys are now in config/secrets.js (gitignored)
  images: {
    domains: [
      'img.reservoir.tools', // Reservoir Tools images
      'ipfs.io', // IPFS gateway
      'gateway.ipfs.io',
      'ipfs.infura.io',
      'gateway.pinata.cloud',
      'nft.storage',
      'magiceden.io',
      'arweave.net',
      'cdn.magiceden.dev',
      'opensea.io',
      'i.seadn.io',
      'openseauserdata.com',
    ],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.reservoir.tools'
      },
      {
        protocol: 'https',
        hostname: '**.ipfs.io'
      },
      {
        protocol: 'https',
        hostname: '**.magiceden.io'
      },
      {
        protocol: 'https',
        hostname: '**.seadn.io'
      },
      {
        protocol: 'https',
        hostname: '**.opensea.io'
      }
    ],
    // Disable image optimization in development to prevent 403 errors
    unoptimized: process.env.NODE_ENV === 'development'
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      'process/browser': require.resolve('process/browser.js'),
    };
    config.resolve.fallback = {
      ...config.resolve.fallback,
      process: require.resolve('process/browser.js'),
      fs: false,
      net: false,
      tls: false,
    };
    return config;
  },
};

module.exports = nextConfig; 
require("@nomicfoundation/hardhat-ethers");
require("dotenv").config({ path: '.env.local' });

module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    monad: {
      url: process.env.NEXT_PUBLIC_MONAD_RPC_URL || "https://rpc.monad.xyz",
      chainId: 143,
      accounts: (process.env.PRIVATE_KEY && process.env.PRIVATE_KEY.length > 10) ? [process.env.PRIVATE_KEY] : [],
      gasPrice: "auto",
      timeout: 120000,
    },
    // Monad Testnet (camelCase)
    monadTestnet: {
      url: "https://testnet-rpc.monad.xyz/",
      chainId: 10143,
      accounts: (process.env.PRIVATE_KEY && process.env.PRIVATE_KEY.length > 10) ? [process.env.PRIVATE_KEY] : [],
      gasPrice: "auto",
      timeout: 60000,
    },
    // Monad Testnet (kebab-case alias)
    "monad-testnet": {
      url: "https://testnet-rpc.monad.xyz/",
      chainId: 10143,
      accounts: (process.env.PRIVATE_KEY && process.env.PRIVATE_KEY.length > 10) ? [process.env.PRIVATE_KEY] : [],
      gasPrice: "auto",
      timeout: 60000,
    },
    robinhoodTestnet: {
      url: "https://rpc.testnet.chain.robinhood.com",
      chainId: 46630,
      accounts: (process.env.PRIVATE_KEY && process.env.PRIVATE_KEY.length > 10) ? [process.env.PRIVATE_KEY] : [],
      gasPrice: "auto",
      timeout: 60000,
    },
    robinhood: {
      url: "https://rpc.mainnet.chain.robinhood.com",
      chainId: 4663,
      accounts: (process.env.PRIVATE_KEY && process.env.PRIVATE_KEY.length > 10) ? [process.env.PRIVATE_KEY] : [],
      gasPrice: "auto",
      timeout: 60000,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    hardhat: {
      chainId: 31337,
    },
  },
};
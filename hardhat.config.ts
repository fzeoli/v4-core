import type { HardhatUserConfig } from "hardhat/config";
import HardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";

const fuzzRuns = process.env.HARDHAT_FUZZ_RUNS
  ? parseInt(process.env.HARDHAT_FUZZ_RUNS, 10)
  : 1000;

const config: HardhatUserConfig = {
  plugins: [HardhatToolboxViem],
  solidity: {
    profiles: {
      default: {
        version: "0.8.26",
        settings: {
          evmVersion: "cancun",
          optimizer: {
            enabled: true,
            runs: 44444444,
          },
          viaIR: true,
          metadata: {
            bytecodeHash: "none",
          },
        },
      },
      debug: {
        version: "0.8.26",
        settings: {
          evmVersion: "cancun",
          optimizer: { enabled: true, runs: 200 },
          viaIR: false,
        },
      },
    },
  },
  paths: {
    sources: "./src",
    tests: "./test",
  },
  test: {
    solidity: {
      ffi: true,
      blockGasLimit: 300_000_000n,
      fsPermissions: {
        readDirectory: ["./test", "./.forge-snapshots"],
      },
      fuzz: {
        runs: fuzzRuns,
        seed: "0x4444",
      },
    },
  },
};

export default config;

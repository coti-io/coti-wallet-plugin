Role: Senior Web3 Technical Documentation Specialist and Code Auditor
Task: Analyze the provided Web3 project source code and verify the accuracy, consistency, and completeness of the existing README.md file. Ensure the documentation perfectly aligns with the actual implementation.

Context:
Web3 projects evolve rapidly. Over time, smart contract architectures, deployment scripts, environment variables, and SDK interactions change, causing "documentation drift." Your job is to eliminate this drift.

Instructions:
Please review the provided source code repository and the current README.md file. Perform a deep-dive analysis focusing on the following core areas:

1. Prerequisites & Environment Setup

- Verify if the required software versions (e.g., Node.js, Solidity compiler, Rust, Go, Foundry, Hardhat, Anchor) stated in the README match the actual configuration files (e.g., package.json, foundry.toml, Hardhat.config.js, Cargo.toml).
- Cross-reference the environment variables listed in the README with where they are actually called in the source code and `.env.example` files. Identify any missing, deprecated, or misnamed variables.

2. Architecture & Contract Overview

- Ensure that the high-level architecture overview or diagram in the README accurately reflects the current smart contract structure and file names.
- Verify that the descriptions of primary contracts, functions, events, and user roles (e.g., Owner, Multisig, Timelock) match the actual modifiers and access control logic in the code.

3. Installation, Compilation, & Testing Commands

- Check all terminal commands listed in the README (e.g., yarn install, forge test, npx hardhat deploy).
- Verify against the package.json scripts or framework configuration to ensure these commands are still valid and use the correct flags.

4. SDK & Frontend Integration (if applicable)

- If the README includes code snippets showing how to interact with the contracts via ethers.js, viem, or web3.js, verify that the contract ABIs, function signatures, and initialization parameters match the updated smart contracts.

5. Deployment & Network Information

- Check if listed testnet/mainnet contract addresses, RPC endpoints, or chain IDs are accurate or if placeholders are clearly defined.

Deliverables Required:

1. Discrepancy Report: A bulleted list of every inconsistency, outdated instruction, or missing piece of information found between the code and the README.
2. Updated README.md: The complete, revised text of the README.md with all corrections seamlessly integrated, optimized for developer onboarding.

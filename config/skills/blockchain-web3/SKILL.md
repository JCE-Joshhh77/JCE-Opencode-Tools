---
name: blockchain-web3
description: Solidity, gas optimization, ERC standards, DeFi, Foundry/Hardhat. Use when working on blockchain-web3 tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Blockchain & Web3

## Auto-Detect

Trigger this skill when:
- Task mentions: Solidity, smart contract, blockchain, DeFi, ERC-20, NFT, Web3, Ethereum, L2
- Files: `*.sol`, `hardhat.config.*`, `foundry.toml`, `contracts/`, `deploy/`
- Patterns: token, staking, swap, governance, bridge, oracle, account abstraction
- Dependencies: `ethers`, `viem`, `hardhat`, `@openzeppelin/contracts`, `wagmi`

---

## Decision Tree: Architecture

```
What are you building?
├── Token (fungible)?
│   └── ERC-20 (OpenZeppelin base, add mint/burn/pause as needed)
├── NFT / digital asset?
│   ├── Simple collectible → ERC-721
│   └── Semi-fungible (game items, tickets) → ERC-1155
├── DeFi protocol?
│   ├── Lending → Compound/Aave fork patterns
│   ├── DEX → Uniswap V3/V4 concentrated liquidity
│   └── Yield → Vault pattern (ERC-4626)
├── Account abstraction (smart wallets)?
│   └── ERC-4337: UserOperation + Bundler + Paymaster
├── Governance?
│   └── Governor + Timelock (OpenZeppelin)
└── Cross-chain?
    ├── Optimistic bridge → 7-day challenge period
    └── ZK bridge → Proof verification on-chain
```

## Decision Tree: L2 Selection

```
├── Need EVM equivalence + large ecosystem? → Arbitrum One
├── Need cheapest fees for high-volume? → Base or Optimism (OP Stack)
├── Need privacy / ZK proofs? → zkSync Era or Polygon zkEVM
├── Need app-specific chain? → OP Stack (fork) or Arbitrum Orbit
├── Need Bitcoin security + EVM? → Consider Stacks or BOB
└── Gaming / high TPS? → Immutable zkEVM or Ronin
```

## Decision Tree: Testing

```
├── Unit tests (pure logic)? → Foundry (Solidity tests, fastest)
├── Integration (multi-contract)? → Foundry with fork testing
├── Fuzz testing? → Foundry built-in fuzzer (stateless + stateful)
├── Invariant testing? → Foundry invariant tests
├── Formal verification? → Certora Prover or Halmos
└── Security audit prep? → Slither (static) + Mythril (symbolic)
```

---

## Solidity 0.8.28 Patterns

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title Staking — Stake tokens to earn rewards
/// @dev Checks-Effects-Interactions pattern throughout
contract Staking is AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    IERC20 public immutable stakingToken;
    IERC20 public immutable rewardToken;
    uint256 public rewardRate;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;

    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;
    mapping(address => uint256) public balances;
    uint256 public totalSupply;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);

    error ZeroAmount();
    error InsufficientBalance(uint256 requested, uint256 available);
    error TransferFailed();

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = block.timestamp;
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    /// @notice Stake tokens — CEI pattern
    function stake(uint256 amount) external nonReentrant whenNotPaused updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();
        // Effects
        totalSupply += amount;
        balances[msg.sender] += amount;
        // Interaction
        if (!stakingToken.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        emit Staked(msg.sender, amount);
    }

    function earned(address account) public view returns (uint256) {
        return (balances[account] * (rewardPerToken() - userRewardPerTokenPaid[account])) / 1e18
            + rewards[account];
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalSupply == 0) return rewardPerTokenStored;
        return rewardPerTokenStored +
            ((block.timestamp - lastUpdateTime) * rewardRate * 1e18) / totalSupply;
    }
}
```

---

## ERC-4337 Account Abstraction

```solidity
// Minimal smart account compatible with ERC-4337
import {IAccount} from "account-abstraction/interfaces/IAccount.sol";
import {UserOperation} from "account-abstraction/interfaces/UserOperation.sol";

contract SmartAccount is IAccount {
    address public owner;
    address public immutable entryPoint;
    uint256 public nonce;

    error NotEntryPoint();
    error InvalidSignature();

    modifier onlyEntryPoint() {
        if (msg.sender != entryPoint) revert NotEntryPoint();
        _;
    }

    /// @dev Validate UserOperation signature
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external onlyEntryPoint returns (uint256 validationData) {
        // Verify ECDSA signature from owner
        bytes32 hash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", userOpHash));
        address signer = ECDSA.recover(hash, userOp.signature);
        if (signer != owner) return 1; // SIG_VALIDATION_FAILED

        // Pay prefund if needed
        if (missingAccountFunds > 0) {
            (bool success,) = payable(entryPoint).call{value: missingAccountFunds}("");
            (success); // Ignore failure (EntryPoint will revert anyway)
        }
        return 0; // SIG_VALIDATION_SUCCESS
    }

    /// @dev Execute arbitrary call (only via EntryPoint after validation)
    function execute(address dest, uint256 value, bytes calldata data) external onlyEntryPoint {
        (bool success, bytes memory result) = dest.call{value: value}(data);
        if (!success) assembly { revert(add(result, 32), mload(result)) }
    }
}
```

---

## Gas Optimization

```solidity
// 1. Storage packing (each slot = 32 bytes)
contract Packed {
    // Slot 0: 20 + 4 + 1 + 1 = 26 bytes (fits in one slot)
    address owner;       // 20 bytes
    uint32 timestamp;    // 4 bytes
    uint8 status;        // 1 byte
    bool active;         // 1 byte
    // Slot 1
    uint256 balance;     // 32 bytes (full slot)
}

// 2. Custom errors (save ~100 gas vs require strings)
error Unauthorized(address caller);
if (msg.sender != owner) revert Unauthorized(msg.sender);

// 3. Cache storage in memory
function sumBalances(address[] calldata users) external view returns (uint256 total) {
    uint256 len = users.length;
    for (uint256 i; i < len;) {
        total += balances[users[i]];
        unchecked { ++i; }
    }
}

// 4. Use calldata for read-only external params
function process(bytes calldata data) external pure returns (bytes32) {
    return keccak256(data); // No memory copy
}

// 5. Immutable for constructor-set values (bytecode, not storage)
address public immutable factory = msg.sender;

// 6. Transient storage (EIP-1153, Solidity 0.8.24+)
// Use for reentrancy locks, flash loan callbacks — cleared after tx
```

---

## Foundry Testing

```solidity
// test/Staking.t.sol
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {Staking} from "../src/Staking.sol";

contract StakingTest is Test {
    Staking staking;
    address alice = makeAddr("alice");

    function setUp() public {
        // Deploy with test tokens
        staking = new Staking(address(stakingToken), address(rewardToken), 1e18);
        deal(address(stakingToken), alice, 1000e18);
        vm.prank(alice);
        stakingToken.approve(address(staking), type(uint256).max);
    }

    function test_Stake() public {
        vm.prank(alice);
        staking.stake(100e18);
        assertEq(staking.balances(alice), 100e18);
    }

    function test_RevertWhen_StakeZero() public {
        vm.prank(alice);
        vm.expectRevert(Staking.ZeroAmount.selector);
        staking.stake(0);
    }

    // Fuzz: any valid amount should work
    function testFuzz_Stake(uint256 amount) public {
        amount = bound(amount, 1, 1000e18);
        vm.prank(alice);
        staking.stake(amount);
        assertEq(staking.balances(alice), amount);
    }

    // Fork test: interact with mainnet contracts
    function test_ForkMainnet() public {
        vm.createSelectFork("mainnet", 19_000_000);
        // Test against real deployed contracts
    }

    // Invariant: total supply always equals sum of balances
    function invariant_TotalSupplyConsistency() public view {
        // Handler contract calls stake/withdraw randomly
        assertEq(staking.totalSupply(), handler.ghost_totalStaked());
    }
}
```

---

## Security Checklist

```
Critical vulnerabilities to check:
├── Reentrancy → ReentrancyGuard + CEI pattern
├── Access control → Role-based (AccessControl), never tx.origin
├── Integer overflow → Solidity 0.8+ (careful with unchecked)
├── Front-running → Commit-reveal, MEV protection (Flashbots)
├── Oracle manipulation → TWAP or Chainlink, never spot price
├── Flash loan attacks → Check invariants post-interaction
├── Delegate call to untrusted → Avoid or validate target
├── Storage collision (proxies) → Use EIP-1967 storage slots
└── Denial of service → No unbounded loops, pull-over-push
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| No reentrancy guard | Funds drained via recursive calls | ReentrancyGuard + CEI pattern |
| Using tx.origin | Phishing via proxy contracts | Always msg.sender for auth |
| Unbounded loops | Transaction out-of-gas | Pagination or pull pattern |
| Spot price for DeFi logic | Flash loan manipulation | TWAP or Chainlink oracle |
| No upgrade path | Cannot fix critical bugs | UUPS proxy (EIP-1822) |
| transfer/send for ETH | Breaks with > 2300 gas recipients | call{value:} + reentrancy guard |
| No event emission | Off-chain indexing impossible | Emit events for all state changes |
| Hardcoded chain assumptions | Breaks on L2 (block.timestamp, gas) | Abstract chain-specific logic |

---

## Verification Checklist

- [ ] All external calls use CEI pattern (checks-effects-interactions)
- [ ] ReentrancyGuard on all state-changing external functions
- [ ] Custom errors used instead of require strings
- [ ] Storage variables packed efficiently (check with `forge inspect`)
- [ ] Fuzz tests cover all public functions with valid input ranges
- [ ] Invariant tests verify protocol-level properties
- [ ] Slither static analysis passes with no high/medium findings
- [ ] Gas snapshot tracked (`forge snapshot`) — no regressions
- [ ] Events emitted for all state changes (indexer compatibility)
- [ ] Access control tested: unauthorized calls revert correctly

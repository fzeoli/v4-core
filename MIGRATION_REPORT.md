# Foundry to Hardhat 3 Migration Report

**Project:** Uniswap v4-core
**Date:** 2026-01-31
**Branch:** `hardhat-migration`

## Executive Summary

This report documents the migration attempt from Foundry to Hardhat 3 for the Uniswap v4-core project. While Hardhat 3 advertises native support for forge-std and Foundry-style Solidity tests, significant compatibility gaps were discovered that prevent a seamless migration.

**Result:** 543 tests passing, 55 tests failing (~91% compatibility)

---

## 1. Configuration Differences

### 1.1 Solidity Compiler Configuration

**Foundry (`foundry.toml`):**
```toml
[profile.default]
solc_version = "0.8.26"
evm_version = "cancun"
optimizer_runs = 44444444
via_ir = true
bytecode_hash = "none"
```

**Hardhat 3 (`hardhat.config.ts`):**
```typescript
solidity: {
  profiles: {
    default: {
      version: "0.8.26",
      settings: {
        evmVersion: "cancun",
        optimizer: { enabled: true, runs: 44444444 },
        viaIR: true,
        metadata: { bytecodeHash: "none" },
      },
    },
  },
},
```

**Gap:** Hardhat 3 requires a `profiles` object with a mandatory `default` profile. The top-level `version` field cannot coexist with `profiles`. This differs from Foundry's flat configuration style.

### 1.2 Build Profiles

**Foundry:** Uses `[profile.pr]` and `[profile.ci]` sections with different fuzz run counts, activated via `FOUNDRY_PROFILE` environment variable.

**Hardhat 3:** Uses `--build-profile` flag and environment variables like `HARDHAT_FUZZ_RUNS`. The profile system works but environment variable naming differs.

### 1.3 ESM Requirement

**Gap:** Hardhat 3 requires `"type": "module"` in `package.json`. This is a hard requirement that Foundry projects won't have.

---

## 2. Cheatcode Compatibility Gaps

### 2.1 `vm.expectRevert` Behavior (CRITICAL)

This is the most significant compatibility issue discovered.

**Foundry behavior:**
```solidity
vm.expectRevert();
someContract.functionThatReverts();
// Test passes if the call reverts
```

**Hardhat 3 behavior:**
The same code produces:
```
Error: call didn't revert at a lower depth than cheatcode call depth
```

**Affected test patterns:**

1. **Assembly reverts:**
```solidity
// test/libraries/BitMath.t.sol:8
function test_mostSignificantBit_revertsWhenZero() public {
    vm.expectRevert();
    BitMath.mostSignificantBit(0);
}
```
Fails because `BitMath.mostSignificantBit` uses assembly `revert(0, 0)`.

2. **Custom error reverts via CustomRevert.sol:**
```solidity
// test/libraries/SafeCast.t.sol
function test_toUint160() public {
    vm.expectRevert(SafeCast.SafeCastOverflow.selector);
    SafeCastTest(address(this)).toUint160(type(uint256).max);
}
```
Fails with "call didn't revert at a lower depth than cheatcode call depth".

3. **Panic code reverts:**
```solidity
// test/libraries/FullMath.t.sol:18
function test_mulDiv_revertsWithOverflowingNumeratorAndZeroDenominator() public {
    vm.expectRevert();
    FullMath.mulDiv(type(uint256).max, type(uint256).max, 0);
}
```
Division by zero panic not caught by `vm.expectRevert()`.

**Affected tests (55 total):**
- `SafeCastTest`: 11 failures
- `FullMathTest`: 6 failures
- `TestBalanceDelta`: 4 failures
- `TestBitMath`: 2 failures
- `TickTest`: 1 failure
- `TickBitmapTest`: 1 failure
- `HooksTest`: 2 failures
- `PoolTest`: Various fuzz failures
- And others involving `vm.expectRevert`

### 2.2 `vm.expectRevert` with Custom Errors

**Foundry:**
```solidity
vm.expectRevert(abi.encodeWithSelector(CustomError.selector, arg1, arg2));
```

**Hardhat 3:**
Custom errors are reported as "unrecognized custom error" with raw return data:
```
Error: reverted with an unrecognized custom error (return data: 0x93dafdf1)
```

The selector `0x93dafdf1` is not decoded, making debugging difficult.

### 2.3 Gas Snapshot Cheatcodes

**Foundry:**
```solidity
vm.snapshotGasLastCall("operation_name");
```
Writes to `.forge-snapshots/` directory.

**Hardhat 3:**
The `snapshotGasLastCall` cheatcode exists but behaves differently:
- Requires `fsPermissions.readDirectory` configuration
- File path handling differs
- Snapshot format may differ

**Workaround:** Configure `fsPermissions` in hardhat.config.ts:
```typescript
test: {
  solidity: {
    fsPermissions: {
      readDirectory: ["./.forge-snapshots"],
    },
  },
},
```

### 2.4 FFI Cheatcode (`vm.ffi`)

**Foundry:**
```solidity
string[] memory inputs = new string[](3);
inputs[0] = "node";
inputs[1] = "script.js";
inputs[2] = arg;
bytes memory result = vm.ffi(inputs);
```

**Hardhat 3:**
- Requires explicit `ffi: true` in config
- Requires `fsPermissions` for file access
- JavaScript execution context may differ

**Configuration required:**
```typescript
test: {
  solidity: {
    ffi: true,
    fsPermissions: {
      readDirectory: ["./test"],
    },
  },
},
```

### 2.5 `vm.readFileBinary`

**Foundry:** Works with relative paths from project root.

**Hardhat 3:**
```
Error: vm.readFileBinary: the path test/bin/v3Factory.bytecode is not allowed to be accessed for read operations
```

Requires explicit `fsPermissions` configuration. Even with configuration, path resolution may differ.

---

## 3. Import Resolution Differences

### 3.1 Direct Import Paths

**Foundry:** Allows direct imports like:
```solidity
import "test/utils/Deployers.sol";
```

**Hardhat 3:**
```
Error HHE902: You are trying to import a local file with a direct import path
instead of a relative one, and this is not allowed by Hardhat.
```

**Solution:** Add remappings to `remappings.txt`:
```
test/=test/
src/=src/
```

### 3.2 Remappings File

Both Foundry and Hardhat 3 read `remappings.txt`, but:
- Hardhat 3 is stricter about requiring remappings for non-relative imports
- Some remappings that work in Foundry may need adjustment

---

## 4. Test Discovery Differences

### 4.1 Test File Patterns

**Foundry:** Only compiles and runs `*.t.sol` files as tests.

**Hardhat 3:** The `hardhat test` command runs both Solidity and Node.js tests. JavaScript files in the test directory are picked up:
```
57) /home/debian/v4-core/test/js-scripts/build.js:
   Test file execution failed (exit code 1).
```

**Solution:** Use `hardhat test solidity` to run only Solidity tests.

### 4.2 Test Contract Detection

Both systems detect contracts inheriting from `Test`, but Hardhat 3 may have subtle differences in how test functions are identified.

---

## 5. Error Reporting Differences

### 5.1 Custom Error Display

**Foundry:**
```
Error: MyCustomError(arg1, arg2)
```

**Hardhat 3:**
```
Error: reverted with an unrecognized custom error (return data: 0x...)
```

Custom errors are not decoded by name, only showing raw selector bytes.

### 5.2 Stack Traces

**Foundry:** Uses `-vvv` or `-vvvv` for verbosity.

**Hardhat 3:** Uses `--verbosity` or `-v` flag with numeric levels.

### 5.3 Counterexample Display

Both show counterexamples for failing fuzz tests, but the format differs slightly. Hardhat 3 shows raw calldata bytes alongside decoded args.

---

## 6. Gas Reporting Differences

### 6.1 Gas Statistics

**Foundry:** `forge test --gas-report`

**Hardhat 3:** `hardhat test --gas-stats`

The output format and level of detail differ.

### 6.2 Snapshot Comparison

**Foundry:** `FORGE_SNAPSHOT_CHECK=true` environment variable.

**Hardhat 3:** Different mechanism, not directly compatible with `.forge-snapshots/` format.

---

## 7. Performance Observations

Compilation and test execution times were comparable, but:
- Hardhat 3 requires npm package installation (~171 packages)
- Initial compilation downloads solc binaries
- viaIR compilation is slow in both systems

---

## 8. Workarounds Attempted

### 8.1 Successful Workarounds

1. **ESM migration:** Added `"type": "module"` to package.json
2. **Profile configuration:** Used Hardhat 3's profile syntax
3. **Import remappings:** Added `test/=test/` and `src/=src/`
4. **FFI permissions:** Configured `fsPermissions`
5. **Test command:** Used `hardhat test solidity` instead of `hardhat test`

### 8.2 Unsuccessful Workarounds

1. **`vm.expectRevert` failures:** No configuration-level fix available
2. **Custom error decoding:** Cannot be fixed without Hardhat 3 updates
3. **Gas snapshot compatibility:** Would require test modifications

---

## 9. Recommendations

### 9.1 If Proceeding with Migration

1. **Modify failing tests:** Refactor 55 tests to avoid `vm.expectRevert` patterns that don't work
2. **Use try/catch:** Replace `vm.expectRevert` with try/catch blocks where possible
3. **Skip incompatible tests:** Mark tests as skipped until Hardhat 3 improves
4. **Update CI:** Adjust expected test counts

### 9.2 If Staying with Foundry

1. **Revert changes:** `git checkout main`
2. **Monitor Hardhat 3:** Re-evaluate when compatibility improves
3. **Document findings:** Keep this report for future reference

### 9.3 Hybrid Approach

Run both test systems:
- Foundry for full test coverage
- Hardhat 3 for TypeScript tooling and deployment scripts

---

## 10. Detailed Failure Analysis

### Category A: `vm.expectRevert` with No Selector (17 tests)

Tests that use bare `vm.expectRevert()` without specifying an error:

| Test File | Test Function | Root Cause |
|-----------|---------------|------------|
| BitMath.t.sol | test_mostSignificantBit_revertsWhenZero | Assembly revert |
| BitMath.t.sol | test_leastSignificantBit_revertsWhenZero | Assembly revert |
| FullMath.t.sol | test_mulDiv_revertsWithOverflowingNumeratorAndZeroDenominator | Division by zero |
| FullMath.t.sol | test_mulDiv_revertsOverflowWithAllMaxInputs | Overflow |
| FullMath.t.sol | test_mulDiv_revertsIfOutputOverflows | Overflow |
| FullMath.t.sol | test_mulDivRoundingUp_revertsIfMulDivOverflows256BitsAfterRoundingUp | Overflow |
| FullMath.t.sol | test_mulDivRoundingUp_revertsIfMulDivOverflows256BitsAfterRoundingUpCase2 | Overflow |
| FullMath.t.sol | test_fuzz_mulDiv_revertsWith0Denominator | Division by zero |
| FullMath.t.sol | test_fuzz_mulDivRoundingUp_revertsWith0Denominator | Division by zero |

### Category B: `vm.expectRevert` with Custom Error Selector (27 tests)

Tests that expect specific custom errors:

| Test File | Test Function | Expected Error |
|-----------|---------------|----------------|
| SafeCast.t.sol | test_toUint160 | SafeCastOverflow |
| SafeCast.t.sol | test_toUint128_fromUint256 | SafeCastOverflow |
| SafeCast.t.sol | test_toInt256 | SafeCastOverflow |
| SafeCast.t.sol | test_toInt128_fromUint256 | SafeCastOverflow |
| SafeCast.t.sol | test_toInt128_fromInt256 | SafeCastOverflow |
| SafeCast.t.sol | test_fuzz_toUint160 | SafeCastOverflow |
| SafeCast.t.sol | test_fuzz_toUint128_fromUint256 | SafeCastOverflow |
| SafeCast.t.sol | test_fuzz_toUint128_fromInt128 | SafeCastOverflow |
| SafeCast.t.sol | test_fuzz_toInt256 | SafeCastOverflow |
| SafeCast.t.sol | test_fuzz_toInt128_fromUint256 | SafeCastOverflow |
| SafeCast.t.sol | test_fuzz_toInt128_fromInt256 | SafeCastOverflow |
| BalanceDelta.t.sol | test_add_revertsOnOverflow | SafeCastOverflow |
| BalanceDelta.t.sol | test_sub_revertsOnUnderflow | SafeCastOverflow |
| BalanceDelta.t.sol | test_fuzz_add | SafeCastOverflow |
| BalanceDelta.t.sol | test_fuzz_sub | SafeCastOverflow |
| Tick.t.sol | testTick_update_revertsOnOverflowLiquidityGross | TickLiquidityOverflow |
| Hooks.t.sol | test_fuzz_validateHookAddress_failsNoHooks | HookAddressNotValid |
| Hooks.t.sol | test_fuzz_validateHookAddress_failsAllHooks | HookAddressNotValid |

### Category C: Fuzz Test Failures Due to Revert Handling (11 tests)

Fuzz tests that encounter reverts during fuzzing:

| Test File | Test Function | Issue |
|-----------|---------------|-------|
| TickBitmap.t.sol | test_fuzz_flipTick | TickMisaligned error not caught |
| Pool.t.sol | test_fuzz_swap | Various initialization errors |
| Pool.t.sol | test_fuzz_modifyLiquidity | Liquidity errors |

---

## 11. Files Modified in Migration

| File | Action | Notes |
|------|--------|-------|
| `hardhat.config.ts` | Created | Hardhat 3 configuration |
| `tsconfig.json` | Created | TypeScript for config |
| `package.json` | Modified | Added deps, scripts, ESM |
| `remappings.txt` | Modified | Added test/, src/ |
| `.gitignore` | Modified | Added typechain-types/ |
| `.github/workflows/tests-pr.yml` | Rewritten | Node.js + Hardhat |
| `.github/workflows/tests-merge.yml` | Rewritten | Node.js + Hardhat |
| `.github/workflows/lint.yml` | Modified | Removed forge fmt |
| `.github/workflows/deploy.yaml` | Modified | Hardhat compile |
| `foundry.toml` | Deleted | Foundry config |
| `justfile` | Deleted | Foundry commands |

---

## 12. Conclusion

Hardhat 3's forge-std compatibility is approximately **91%** for this codebase. The primary blocker is `vm.expectRevert` behavior differences, which affect tests that verify error conditions.

**Recommendation:** Unless the failing tests can be refactored or the Hardhat team addresses these compatibility gaps, staying with Foundry is advisable for projects with comprehensive revert testing.

---

## Appendix: Environment Details

- **Hardhat Version:** 3.1.5
- **Node.js Version:** 22.x (required by Hardhat 3)
- **Solidity Version:** 0.8.26
- **forge-std Version:** 1de6eecf821de7fe2c908cc48d3ab3dced20717f
- **OS:** Linux (Ubuntu)

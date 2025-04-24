
import { describe, expect, it } from "vitest";

const accounts = simnet.getAccounts();
const address1 = accounts.get("wallet_1")!;

/*
  The test below is an example. To learn more, read the testing documentation here:
  https://docs.hiro.so/stacks/clarinet-js-sdk
*/

describe("example tests", () => {
  it("ensures simnet is well initialised", () => {
    expect(simnet.blockHeight).toBeDefined();
  });

  // it("shows an example", () => {
  //   const { result } = simnet.callReadOnlyFn("counter", "get-counter", [], address1);
  //   expect(result).toBeUint(0);
  // });
});
import { describe, expect, it, beforeEach } from "vitest";

// Mock implementation of the Clarity contract for testing purposes
class LiquidStakingProtocol {
  // State variables
  private protocolOwner: string;
  private totalStakedStx: number = 0;
  private accumulatedRewardsPerToken: number = 0;
  private stakingEnabled: boolean = true;
  private protocolFeePercent: number = 100; // 1% as basis points
  private unstakingCooldownBlocks: number = 144; // ~1 day
  private exchangeRatePrecision: number = 1000000; // 6 decimals
  private currentBlockHeight: number = 0;

  // Maps
  private stakerBalances: Map<string, number> = new Map();
  private stakerRewardDebt: Map<string, number> = new Map();
  private unstakingRequests: Map<string, {amount: number, availableAtBlock: number}> = new Map();
  private lstSTXBalances: Map<string, number> = new Map();
  private totalLstSTXSupply: number = 0;

  // Error constants
  private readonly ERR_UNAUTHORIZED = { err: 1 };
  private readonly ERR_INSUFFICIENT_BALANCE = { err: 2 };
  private readonly ERR_INVALID_PARAMETER = { err: 3 };
  private readonly ERR_NOT_ENOUGH_FUNDS = { err: 4 };
  private readonly ERR_CONTRACT_FROZEN = { err: 5 };
  private readonly ERR_UNSTAKE_NOT_ALLOWED = { err: 6 };
  private readonly ERR_REWARDS_DISTRIBUTION_FAILED = { err: 7 };
  private readonly ERR_REWARD_ALREADY_CLAIMED = { err: 8 };
  private readonly ERR_COOLDOWN_PERIOD = { err: 9 };
  private readonly ERR_TRANSFER_FAILED = { err: 10 };

  // Current sender for transaction context
  private currentSender: string;

  constructor(initialOwner: string) {
    this.protocolOwner = initialOwner;
    this.currentSender = initialOwner;
  }

  // Helper to set the current transaction sender
  setSender(sender: string) {
    this.currentSender = sender;
  }

  // Helper to advance the blockchain
  advanceBlocks(blocks: number) {
    this.currentBlockHeight += blocks;
    return this.currentBlockHeight;
  }

  // Helper to set STX balance for testing
  setSTXBalance(address: string, amount: number) {
    // This is just for testing - in reality, the contract would check actual STX balances
    this.stakerBalances.set(`stx-${address}`, amount);
  }

  getSTXBalance(address: string): number {
    return this.stakerBalances.get(`stx-${address}`) || 0;
  }

  // Initialize the protocol
  initialize(owner: string, feePercent: number, cooldownBlocks: number) {
    if (this.currentSender !== this.protocolOwner) {
      return this.ERR_UNAUTHORIZED;
    }
    
    this.protocolOwner = owner;
    this.protocolFeePercent = feePercent;
    this.unstakingCooldownBlocks = cooldownBlocks;
    
    return { ok: true };
  }

  // SIP-010 implementation for lstSTX token
  getName() {
    return { ok: "Liquid Staked STX" };
  }

  getSymbol() {
    return { ok: "lstSTX" };
  }

  getDecimals() {
    return { ok: 6 };
  }

  getTokenUri() {
    return { ok: null };
  }

  getBalance(account: string) {
    return { ok: this.lstSTXBalances.get(account) || 0 };
  }

  getTotalSupply() {
    return { ok: this.totalLstSTXSupply };
  }

  getProtocolFee() {
    return this.protocolFeePercent;
  }

  getStakingStatus() {
    return this.stakingEnabled;
  }

  getExchangeRate() {
    const totalSupply = this.totalLstSTXSupply;
    
    if (totalSupply === 0) {
      return { ok: this.exchangeRatePrecision }; // 1:1 when empty
    }
    
    return { 
      ok: Math.floor((this.totalStakedStx * this.exchangeRatePrecision) / totalSupply) 
    };
  }

  // Transfer lstSTX tokens
  transfer(amount: number, sender: string, recipient: string, memo: any = null) {
    if (this.currentSender !== sender) {
      return this.ERR_UNAUTHORIZED;
    }
    
    const senderBalance = this.lstSTXBalances.get(sender) || 0;
    
    if (senderBalance < amount) {
      return this.ERR_INSUFFICIENT_BALANCE;
    }
    
    this.lstSTXBalances.set(sender, senderBalance - amount);
    this.lstSTXBalances.set(recipient, (this.lstSTXBalances.get(recipient) || 0) + amount);
    
    return { ok: true };
  }

  // Stake STX to the protocol
  stake() {
    if (!this.stakingEnabled) {
      return this.ERR_CONTRACT_FROZEN;
    }
    
    const amount = this.getSTXBalance(this.currentSender);
    
    if (amount <= 0) {
      return this.ERR_INSUFFICIENT_BALANCE;
    }
    
    const currentExchangeRate = this.getExchangeRate().ok as number;
    const tokensToMint = Math.floor((amount * this.exchangeRatePrecision) / currentExchangeRate);
    
    // Update staking balances
    this.stakerBalances.set(
      this.currentSender, 
      (this.stakerBalances.get(this.currentSender) || 0) + amount
    );
    this.totalStakedStx += amount;
    
    // Update reward debt
    this.stakerRewardDebt.set(
      this.currentSender,
      (this.stakerRewardDebt.get(this.currentSender) || 0) + 
      (amount * this.accumulatedRewardsPerToken)
    );
    
    // Transfer STX from user to contract (deduct from test balance)
    this.stakerBalances.set(`stx-${this.currentSender}`, 0);
    
    // Mint lstSTX tokens
    this.lstSTXBalances.set(
      this.currentSender, 
      (this.lstSTXBalances.get(this.currentSender) || 0) + tokensToMint
    );
    this.totalLstSTXSupply += tokensToMint;
    
    return { ok: tokensToMint };
  }

  // Request unstaking
  requestUnstake(amount: number) {
    const lstSTXBalance = this.lstSTXBalances.get(this.currentSender) || 0;
    
    if (amount > lstSTXBalance) {
      return this.ERR_INSUFFICIENT_BALANCE;
    }
    
    if (amount <= 0) {
      return this.ERR_INVALID_PARAMETER;
    }
    
    const currentExchangeRate = this.getExchangeRate().ok as number;
    const stxEquivalent = Math.floor((amount * currentExchangeRate) / this.exchangeRatePrecision);
    
    // Burn lstSTX tokens
    this.lstSTXBalances.set(this.currentSender, lstSTXBalance - amount);
    this.totalLstSTXSupply -= amount;
    
    // Create unstaking request
    this.unstakingRequests.set(
      this.currentSender,
      {
        amount: stxEquivalent,
        availableAtBlock: this.currentBlockHeight + this.unstakingCooldownBlocks
      }
    );
    
    // Update staking totals
    this.totalStakedStx -= stxEquivalent;
    
    return { ok: stxEquivalent };
  }

  // Complete unstaking after cooldown
  completeUnstake() {
    const request = this.unstakingRequests.get(this.currentSender);
    
    if (!request || request.amount <= 0) {
      return this.ERR_INSUFFICIENT_BALANCE;
    }
    
    if (request.availableAtBlock > this.currentBlockHeight) {
      return this.ERR_COOLDOWN_PERIOD;
    }
    
    // Clear the unstaking request
    this.unstakingRequests.delete(this.currentSender);
    
    // Transfer STX back to user
    this.stakerBalances.set(
      `stx-${this.currentSender}`, 
      (this.stakerBalances.get(`stx-${this.currentSender}`) || 0) + request.amount
    );
    
    return { ok: request.amount };
  }

  // Distribute staking rewards
  distributeRewards(rewardAmount: number) {
    if (this.currentSender !== this.protocolOwner) {
      return this.ERR_UNAUTHORIZED;
    }
    
    if (rewardAmount <= 0) {
      return this.ERR_INVALID_PARAMETER;
    }
    
    const totalStaked = this.totalStakedStx;
    const feeAmount = Math.floor((rewardAmount * this.protocolFeePercent) / 10000);
    const distributableAmount = rewardAmount - feeAmount;
    
    let rewardPerToken = 0;
    if (totalStaked > 0) {
      rewardPerToken = Math.floor((distributableAmount * this.exchangeRatePrecision) / totalStaked);
    }
    
    // Update accumulated rewards
    this.accumulatedRewardsPerToken += rewardPerToken;
    
    // Send fee to protocol owner (just add to their balance for testing)
    this.stakerBalances.set(
      `stx-${this.protocolOwner}`, 
      (this.stakerBalances.get(`stx-${this.protocolOwner}`) || 0) + feeAmount
    );
    
    return { ok: true };
  }

  // Claim pending rewards
  claimRewards() {
    const stakedBalance = this.stakerBalances.get(this.currentSender) || 0;
    const rewardDebt = this.stakerRewardDebt.get(this.currentSender) || 0;
    const accumulated = this.accumulatedRewardsPerToken;
    
    const pendingReward = Math.floor(
      (stakedBalance * (accumulated - rewardDebt)) / this.exchangeRatePrecision
    );
    
    if (pendingReward <= 0) {
      return this.ERR_NOT_ENOUGH_FUNDS;
    }
    
    // Update reward debt
    this.stakerRewardDebt.set(this.currentSender, stakedBalance * accumulated);
    
    // Transfer rewards to user
    this.stakerBalances.set(
      `stx-${this.currentSender}`, 
      (this.stakerBalances.get(`stx-${this.currentSender}`) || 0) + pendingReward
    );
    
    return { ok: pendingReward };
  }

  // Set staking status
  setStakingStatus(enabled: boolean) {
    if (this.currentSender !== this.protocolOwner) {
      return this.ERR_UNAUTHORIZED;
    }
    
    this.stakingEnabled = enabled;
    return { ok: true };
  }

  // Update protocol fee
  updateProtocolFee(newFeePercent: number) {
    if (this.currentSender !== this.protocolOwner) {
      return this.ERR_UNAUTHORIZED;
    }
    
    if (newFeePercent > 1000) { // Max 10%
      return this.ERR_INVALID_PARAMETER;
    }
    
    this.protocolFeePercent = newFeePercent;
    return { ok: true };
  }

  // Update cooldown period
  updateCooldownPeriod(blocks: number) {
    if (this.currentSender !== this.protocolOwner) {
      return this.ERR_UNAUTHORIZED;
    }
    
    this.unstakingCooldownBlocks = blocks;
    return { ok: true };
  }

  // Get pending rewards
  getPendingRewards(staker: string) {
    const stakedBalance = this.stakerBalances.get(staker) || 0;
    const rewardDebt = this.stakerRewardDebt.get(staker) || 0;
    const accumulated = this.accumulatedRewardsPerToken;
    
    return Math.floor(
      (stakedBalance * (accumulated - rewardDebt)) / this.exchangeRatePrecision
    );
  }

  // Get unstaking request
  getUnstakingRequest(staker: string) {
    return this.unstakingRequests.get(staker);
  }

  // Get protocol stats
  getProtocolStats() {
    return {
      totalStaked: this.totalStakedStx,
      totalLiquidTokens: this.totalLstSTXSupply,
      exchangeRate: this.getExchangeRate().ok,
      stakingEnabled: this.stakingEnabled,
      feePercent: this.protocolFeePercent,
      cooldownBlocks: this.unstakingCooldownBlocks
    };
  }

  // Transfer protocol ownership
  transferOwnership(newOwner: string) {
    if (this.currentSender !== this.protocolOwner) {
      return this.ERR_UNAUTHORIZED;
    }
    
    this.protocolOwner = newOwner;
    return { ok: true };
  }
}

describe("Liquid Staking Protocol Tests", () => {
  let protocol: LiquidStakingProtocol;
  const owner = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
  const user1 = "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG";
  const user2 = "ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC";
  
  beforeEach(() => {
    protocol = new LiquidStakingProtocol(owner);
    protocol.initialize(owner, 100, 144); // 1% fee, 144 blocks cooldown
    
    // Set up initial STX balances for testing
    protocol.setSTXBalance(owner, 1000000);
    protocol.setSTXBalance(user1, 100000);
    protocol.setSTXBalance(user2, 50000);
  });
  
  describe("Protocol Initialization", () => {
    it("should initialize with correct values", () => {
      const stats = protocol.getProtocolStats();
      
      expect(stats.feePercent).toBe(100); // 1%
      expect(stats.cooldownBlocks).toBe(144);
      expect(stats.stakingEnabled).toBe(true);
      expect(stats.totalStaked).toBe(0);
      expect(stats.totalLiquidTokens).toBe(0);
      expect(stats.exchangeRate).toBe(1000000); // 1:1 initially
    });
    
    it("should only allow owner to update protocol parameters", () => {
      // Owner can update fee
      protocol.setSender(owner);
      const result1 = protocol.updateProtocolFee(200); // 2%
      expect(result1).toEqual({ ok: true });
      expect(protocol.getProtocolFee()).toBe(200);
      
      // Non-owner cannot update fee
      protocol.setSender(user1);
      const result2 = protocol.updateProtocolFee(300);
      expect(result2).toEqual({ err: 1 }); // ERR_UNAUTHORIZED
      expect(protocol.getProtocolFee()).toBe(200); // Unchanged
    });
    
    it("should enforce valid fee ranges", () => {
      protocol.setSender(owner);
      
      // Valid fee (10%)
      const result1 = protocol.updateProtocolFee(1000);
      expect(result1).toEqual({ ok: true });
      
      // Invalid fee (>10%)
      const result2 = protocol.updateProtocolFee(1001);
      expect(result2).toEqual({ err: 3 }); // ERR_INVALID_PARAMETER
    });
  });
  
  describe("Staking Operations", () => {
    it("should allow users to stake STX and receive lstSTX", () => {
      protocol.setSender(user1);
      const result = protocol.stake();
      
      expect(result).toEqual({ ok: 100000 }); // 1:1 initial ratio
      
      // Verify balances and state
      expect(protocol.getSTXBalance(user1)).toBe(0); // STX transferred to contract
      expect(protocol.getBalance(user1).ok).toBe(100000); // lstSTX received
      expect(protocol.getTotalSupply().ok).toBe(100000);
      expect(protocol.getProtocolStats().totalStaked).toBe(100000);
    });
    
    it("should maintain correct exchange rate after rewards", () => {
      // User1 stakes 100,000 STX
      protocol.setSender(user1);
      protocol.stake();
      
      // Distribute 10,000 STX rewards (1% fee = 100 STX to owner, 9,900 STX to stakers)
      protocol.setSender(owner);
      protocol.distributeRewards(10000);
      
      // Check exchange rate - should reflect rewards
      // Total staked: 100,000 + 9,900 = 109,900
      // Total lstSTX: 100,000
      // Exchange rate should be ~1.099
      const exchangeRate = protocol.getExchangeRate().ok as number;
      expect(exchangeRate).toBeGreaterThan(1000000); // > 1.0
      
      // User2 stakes 50,000 STX after rewards
      protocol.setSender(user2);
      const result = protocol.stake();
      
      // User2 should get fewer lstSTX due to higher exchange rate
      // ~50,000 / 1.099 = ~45,496 lstSTX
      expect((result as any).ok).toBeLessThan(50000);
      
      // Verify protocol stats are updated
      const stats = protocol.getProtocolStats();
      expect(stats.totalStaked).toBe(159900); // 100,000 + 9,900 + 50,000
    });
    
    it("should not allow staking when protocol is paused", () => {
      // Pause staking
      protocol.setSender(owner);
      protocol.setStakingStatus(false);
      
      // Attempt to stake
      protocol.setSender(user1);
      const result = protocol.stake();
      
      expect(result).toEqual({ err: 5 }); // ERR_CONTRACT_FROZEN
      expect(protocol.getProtocolStats().totalStaked).toBe(0); // No change
    });
  });
  
  describe("Unstaking Operations", () => {
    beforeEach(() => {
      // Setup: User1 stakes 100,000 STX
      protocol.setSender(user1);
      protocol.stake();
    });
    
    it("should allow users to request unstaking", () => {
      protocol.setSender(user1);
      const result = protocol.requestUnstake(50000); // Unstake half
      
      expect(result).toEqual({ ok: 50000 }); // STX equivalent
      
      // Verify state changes
      expect(protocol.getBalance(user1).ok).toBe(50000); // Half lstSTX remaining
      expect(protocol.getTotalSupply().ok).toBe(50000); // Total lstSTX reduced
      expect(protocol.getProtocolStats().totalStaked).toBe(50000); // Half STX unstaked
      
      // Check unstaking request
      const request = protocol.getUnstakingRequest(user1);
      expect(request).toBeDefined();
      expect(request?.amount).toBe(50000);
      expect(request?.availableAtBlock).toBe(144); // Current block (0) + cooldown (144)
    });
    
    it("should not allow completing unstake before cooldown period", () => {
      // Request unstake
      protocol.setSender(user1);
      protocol.requestUnstake(50000);
      
      // Try to complete unstake immediately
      const result = protocol.completeUnstake();
      
      expect(result).toEqual({ err: 9 }); // ERR_COOLDOWN_PERIOD
      expect(protocol.getSTXBalance(user1)).toBe(0); // No STX received yet
    });
    
    it("should allow completing unstake after cooldown period", () => {
      // Request unstake
      protocol.setSender(user1);
      protocol.requestUnstake(50000);
      
      // Advance blocks past cooldown
      protocol.advanceBlocks(150);
      
      // Complete unstake
      const result = protocol.completeUnstake();
      
      expect(result).toEqual({ ok: 50000 });
      expect(protocol.getSTXBalance(user1)).toBe(50000); // STX received
      expect(protocol.getUnstakingRequest(user1)).toBeUndefined(); // Request cleared
    });
    
    it("should handle exchange rate changes during unstaking", () => {
      // Distribute rewards to change exchange rate
      protocol.setSender(owner);
      protocol.distributeRewards(10000); // 9,900 to stakers
      
      // Request unstake (with new exchange rate)
      protocol.setSender(user1);
      const result = protocol.requestUnstake(50000); // Unstake half lstSTX
      
      // Should get more than 50,000 STX due to rewards
      expect((result as any).ok).toBeGreaterThan(50000);
    });
  });
  
  describe("Rewards Distribution", () => {
    beforeEach(() => {
      // Setup: User1 stakes 100,000 STX
      protocol.setSender(user1);
      protocol.stake();
    });
    
    it("should allow distributing rewards", () => {
      protocol.setSender(owner);
      const result = protocol.distributeRewards(10000);
      
      expect(result).toEqual({ ok: true });
      
      // Protocol owner should receive fee
      expect(protocol.getSTXBalance(owner)).toBe(100); // 1% of 10,000
    });
    
    it("should calculate pending rewards correctly", () => {
      // Distribute rewards
      protocol.setSender(owner);
      protocol.distributeRewards(10000); // 9,900 to stakers
      
      // Check pending rewards
      const pendingRewards = protocol.getPendingRewards(user1);
      expect(pendingRewards).toBe(9900); // All rewards go to user1 (only staker)
    });
    
    it("should allow claiming rewards", () => {
      // Distribute rewards
      protocol.setSender(owner);
      protocol.distributeRewards(10000);
      
      // Claim rewards
      protocol.setSender(user1);
      const result = protocol.claimRewards();
      
      expect(result).toEqual({ ok: 9900 });
      expect(protocol.getSTXBalance(user1)).toBe(9900);
      
      // Pending rewards should be zero after claiming
      expect(protocol.getPendingRewards(user1)).toBe(0);
    });
    
    it("should handle multiple stakers fairly", () => {
      // User2 stakes half as much as user1
      protocol.setSender(user2);
      protocol.stake(); // 50,000 STX
      
      // Distribute rewards
      protocol.setSender(owner);
      protocol.distributeRewards(15000);
      
      // Check pending rewards (should be proportional to stake)
      const user1Rewards = protocol.getPendingRewards(user1);
      const user2Rewards = protocol.getPendingRewards(user2);
      
      // User1 has 2/3 of the stake, user2 has 1/3
      // Total distributable rewards: 15,000 * 0.99 = 14,850
      // User1 should get ~9,900, User2 should get ~4,950
      expect(user1Rewards).toBeCloseTo(9900, -1);
      expect(user2Rewards).toBeCloseTo(4950, -1);
    });
  });
  
  describe("Token Operations", () => {
    beforeEach(() => {
      // Setup: User1 stakes 100,000 STX
      protocol.setSender(user1);
      protocol.stake();
    });
    
    it("should allow transferring lstSTX tokens", () => {
      protocol.setSender(user1);
      const result = protocol.transfer(30000, user1, user2);
      
      expect(result).toEqual({ ok: true });
      expect(protocol.getBalance(user1).ok).toBe(70000);
      expect(protocol.getBalance(user2).ok).toBe(30000);
    });
    
    it("should not allow transferring more tokens than balance", () => {
      protocol.setSender(user1);
      const result = protocol.transfer(150000, user1, user2); // More than user1 has
      
      expect(result).toEqual({ err: 2 }); // ERR_INSUFFICIENT_BALANCE
    });
    
    it("should still track rewards correctly after token transfers", () => {
      // Transfer tokens
      protocol.setSender(user1);
      protocol.transfer(50000, user1, user2);
      
      // Distribute rewards
      protocol.setSender(owner);
      protocol.distributeRewards(10000);
      
      // Check pending rewards - only user1 should have rewards (original staker)
      // even though user2 now holds 50% of the lstSTX
      const user1Rewards = protocol.getPendingRewards(user1);
      const user2Rewards = protocol.getPendingRewards(user2);
      
      expect(user1Rewards).toBe(9900); // All rewards go to original staker
      expect(user2Rewards).toBe(0); // No rewards yet for token holder
      
      // If user2 stakes their STX, they'd start earning rewards on future distributions
    });
  });
  
  describe("Protocol Management", () => {
    it("should allow transferring ownership", () => {
      protocol.setSender(owner);
      const result = protocol.transferOwnership(user2);
      
      expect(result).toEqual({ ok: true });
      
      // Old owner can no longer manage protocol
      const updateResult = protocol.updateProtocolFee(300);
      expect(updateResult).toEqual({ err: 1 }); // ERR_UNAUTHORIZED
      
      // New owner can manage protocol
      protocol.setSender(user2);
      const newUpdateResult = protocol.updateProtocolFee(300);
      expect(newUpdateResult).toEqual({ ok: true });
    });
    
    it("should allow updating cooldown period", () => {
      protocol.setSender(owner);
      const result = protocol.updateCooldownPeriod(288); // 2 days
      
      expect(result).toEqual({ ok: true });
      expect(protocol.getProtocolStats().cooldownBlocks).toBe(288);
    });
  });
});
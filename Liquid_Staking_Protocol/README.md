# Liquid Staking Protocol for Stacks

A decentralized protocol that enables STX holders to stake their tokens while maintaining liquidity through tokenized staking positions.

## Overview

This smart contract protocol allows Stacks (STX) holders to stake their tokens and receive liquid staking tokens (lstSTX) in return. These lstSTX tokens represent the user's staked position and can be freely transferred or used in other DeFi applications while the underlying STX continues to earn staking rewards.

## Features

- **Liquid Staking**: Stake STX and receive lstSTX tokens that can be transferred or used elsewhere
- **Dynamic Exchange Rate**: The exchange rate between STX and lstSTX adjusts based on accumulated rewards
- **Reward Distribution**: Automated system for distributing staking rewards to participants
- **Unstaking with Cooldown**: Request to unstake with a configurable cooldown period to maintain protocol stability
- **Protocol Fees**: Configurable fee structure to sustain protocol development and operations
- **SIP-010 Compliance**: The lstSTX token implements the SIP-010 fungible token standard

## How It Works

1. **Staking**: Users deposit STX into the protocol and receive lstSTX tokens based on the current exchange rate
2. **Earning Rewards**: As staking rewards accrue, they are distributed to stakers, increasing the value of lstSTX
3. **Unstaking**: Users can burn their lstSTX to initiate an unstaking request, subject to a cooldown period
4. **Completing Unstake**: After the cooldown period, users can withdraw their STX plus accumulated rewards

## Contract Functions

### Core Functions

- `stake()`: Stake STX and receive lstSTX tokens
- `request-unstake(amount)`: Initiate the unstaking process for a specific amount
- `complete-unstake()`: Withdraw STX after the cooldown period
- `claim-rewards()`: Manually claim accumulated staking rewards

### Administrative Functions

- `initialize(owner, fee-percent, cooldown-blocks)`: Set up protocol parameters
- `distribute-rewards(reward-amount)`: Distribute staking rewards to all participants
- `set-staking-status(enabled)`: Enable or disable staking
- `update-protocol-fee(new-fee-percent)`: Update the protocol fee percentage
- `update-cooldown-period(blocks)`: Update the unstaking cooldown period
- `transfer-ownership(new-owner)`: Transfer protocol ownership

### Read-Only Functions

- `get-exchange-rate()`: Get the current lstSTX to STX exchange rate
- `get-pending-rewards(staker)`: Check pending rewards for a specific staker
- `get-unstaking-request(staker)`: Check the status of an unstaking request
- `get-protocol-stats()`: Get overall protocol statistics
- Standard SIP-010 token functions for lstSTX

## Protocol Parameters

- **Protocol Fee**: Default 1% (100 basis points)
- **Unstaking Cooldown**: Default ~1 day (144 blocks)
- **Exchange Rate Precision**: 6 decimal places (1,000,000)

## Security Considerations

The protocol includes multiple safety mechanisms:
- Authorization checks for administrative functions
- Balance validations to prevent excessive withdrawals
- Cooldown periods to prevent economic attacks
- Safe math operations to prevent under/overflow issues

## Development

This contract is written in Clarity, the smart contract language for the Stacks blockchain. To deploy and interact with this contract, you'll need a Stacks development environment.

## License

[Add your license information here]

## Contributors

[Add contributor information here]

;; title: Liquid Staking Protocol for Stacks
;; version:
;; summary:
;; description: Allows users to stake STX while maintaining liquidity through tokenized staking positions


;; Constants
(define-constant ERR_UNAUTHORIZED (err u1))
(define-constant ERR_INSUFFICIENT_BALANCE (err u2))
(define-constant ERR_INVALID_PARAMETER (err u3))
(define-constant ERR_NOT_ENOUGH_FUNDS (err u4))
(define-constant ERR_CONTRACT_FROZEN (err u5))
(define-constant ERR_UNSTAKE_NOT_ALLOWED (err u6))
(define-constant ERR_REWARDS_DISTRIBUTION_FAILED (err u7))
(define-constant ERR_REWARD_ALREADY_CLAIMED (err u8))
(define-constant ERR_COOLDOWN_PERIOD (err u9))

;; Data variables
(define-data-var protocol-owner principal tx-sender)
(define-data-var total-staked-stx uint u0)
(define-data-var accumulated-rewards-per-token uint u0)
(define-data-var staking-enabled bool true)
(define-data-var protocol-fee-percent uint u100) ;; 1% represented as 100 basis points
(define-data-var unstaking-cooldown-blocks uint u144) ;; ~1 day of blocks
(define-data-var exchange-rate-precision uint u1000000) ;; 6 decimals for precise exchange rate

;; Data maps
(define-map staker-balances principal uint)
(define-map staker-rewards principal uint)
(define-map staker-reward-debt principal uint)
(define-map unstaking-requests
  { staker: principal }
  { amount: uint, available-at-block: uint }
)

;; Token definitions for the liquid staking token (lstSTX) using the SIP-010 interface
(define-fungible-token lstSTX)

;; Initialize the protocol
(define-public (initialize (owner principal) (fee-percent uint) (cooldown-blocks uint))
  (begin
    (asserts! (is-eq tx-sender (var-get protocol-owner)) ERR_UNAUTHORIZED)
    (var-set protocol-owner owner)
    (var-set protocol-fee-percent fee-percent)
    (var-set unstaking-cooldown-blocks cooldown-blocks)
    (ok true)))

    ;; SIP-010 implementation for lstSTX token
(define-read-only (get-name)
  (ok "Liquid Staked STX"))

(define-read-only (get-symbol)
  (ok "lstSTX"))

(define-read-only (get-decimals)
  (ok u6))

(define-read-only (get-token-uri)
  (ok none))

(define-read-only (get-balance (account principal))
  (ok (ft-get-balance lstSTX account)))

(define-read-only (get-total-supply)
  (ok (ft-get-supply lstSTX)))

(define-read-only (get-protocol-fee)
  (var-get protocol-fee-percent))

(define-read-only (get-staking-status)
  (var-get staking-enabled))


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


(define-read-only (get-exchange-rate)
  (let ((total-supply (unwrap-panic (get-total-supply))))
    (if (is-eq total-supply u0)
      (ok (var-get exchange-rate-precision)) ;; 1:1 when empty
      (ok (div-down (mul-down (var-get total-staked-stx) (var-get exchange-rate-precision)) total-supply)))))

;; Helper functions for safe math
(define-private (div-down (a uint) (b uint))
  (if (is-eq b u0)
    u0
    (/ a b)))


(define-private (mul-down (a uint) (b uint))
  (/ (* a b) (var-get exchange-rate-precision)))

;; Transfer tokens
(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) ERR_UNAUTHORIZED)
    (ft-transfer? lstSTX amount sender recipient)))


    ;; Stake STX to the protocol
(define-public (stake)
  (let 
    (
      (amount (stx-get-balance tx-sender))
      (current-exchange-rate (unwrap-panic (get-exchange-rate)))
      (tokens-to-mint (div-down (* amount (var-get exchange-rate-precision)) current-exchange-rate))
    )
    (begin
      (asserts! (var-get staking-enabled) ERR_CONTRACT_FROZEN)
      (asserts! (> amount u0) ERR_INSUFFICIENT_BALANCE)
      
      ;; Update staking balances
      (map-set staker-balances tx-sender (+ (default-to u0 (map-get? staker-balances tx-sender)) amount))
      (var-set total-staked-stx (+ (var-get total-staked-stx) amount))
      
      ;; Update reward debt
      (map-set staker-reward-debt 
        tx-sender 
        (+ (default-to u0 (map-get? staker-reward-debt tx-sender)) 
           (* amount (var-get accumulated-rewards-per-token))))
      
      ;; Transfer STX to contract
      (unwrap! (stx-transfer? amount tx-sender (as-contract tx-sender)) ERR_TRANSFER_FAILED)
      
      ;; Mint lstSTX tokens
      (ft-mint? lstSTX tokens-to-mint tx-sender)
    )
  ))


  ;; Request unstaking - initiates the cooldown period
(define-public (request-unstake (amount uint))
  (let (
      (lstSTX-balance (unwrap-panic (get-balance tx-sender)))
      (current-exchange-rate (unwrap-panic (get-exchange-rate)))
      (stx-equivalent (mul-down amount current-exchange-rate))
    )
    (begin
      (asserts! (<= amount lstSTX-balance) ERR_INSUFFICIENT_BALANCE)
      (asserts! (> amount u0) ERR_INVALID_PARAMETER)
      
      ;; Burn lstSTX tokens
      (ft-burn? lstSTX amount tx-sender)
      
      ;; Create unstaking request
      (map-set unstaking-requests
        { staker: tx-sender }
        { 
          amount: stx-equivalent,
          available-at-block: (+ block-height (var-get unstaking-cooldown-blocks))
        }
      )
      
      ;; Update staking totals
      (var-set total-staked-stx (- (var-get total-staked-stx) stx-equivalent))
      
      (ok stx-equivalent)
    )
  ))

  ;; Complete unstaking after cooldown
(define-public (complete-unstake)
  (let (
      (request (default-to { amount: u0, available-at-block: u0 } 
                (map-get? unstaking-requests { staker: tx-sender })))
      (amount (get amount request))
      (available-at (get available-at-block request))
    )
    (begin
      (asserts! (> amount u0) ERR_INSUFFICIENT_BALANCE)
      (asserts! (<= available-at block-height) ERR_COOLDOWN_PERIOD)
      
      ;; Clear the unstaking request
      (map-delete unstaking-requests { staker: tx-sender })
      
      ;; Transfer STX back to user
      (as-contract (stx-transfer? amount tx-sender tx-sender))
    )
  ))

  ;; Distribute staking rewards (called by the protocol or an external source)
(define-public (distribute-rewards (reward-amount uint))
  (let (
      (total-staked (var-get total-staked-stx))
      (protocol-fee (var-get protocol-fee-percent))
      (fee-amount (/ (* reward-amount protocol-fee) u10000))
      (distributable-amount (- reward-amount fee-amount))
      (reward-per-token (if (> total-staked u0)
                          (/ (* distributable-amount (var-get exchange-rate-precision)) total-staked)
                          u0))
    )
    (begin
      (asserts! (is-eq tx-sender (var-get protocol-owner)) ERR_UNAUTHORIZED)
      (asserts! (> reward-amount u0) ERR_INVALID_PARAMETER)
      
      ;; Update accumulated rewards
      (var-set accumulated-rewards-per-token 
        (+ (var-get accumulated-rewards-per-token) reward-per-token))
      
      ;; Send fee to protocol owner
      (as-contract (stx-transfer? fee-amount tx-sender (var-get protocol-owner)))
      
      (ok true)
    )
  ))

  ;; Claim pending rewards
(define-public (claim-rewards)
  (let (
      (staked-balance (default-to u0 (map-get? staker-balances tx-sender)))
      (reward-debt (default-to u0 (map-get? staker-reward-debt tx-sender)))
      (accumulated (var-get accumulated-rewards-per-token))
      (pending-reward (/ (* staked-balance (- accumulated reward-debt)) (var-get exchange-rate-precision)))
    )
    (begin
      (asserts! (> pending-reward u0) ERR_NOT_ENOUGH_FUNDS)
      
      ;; Update reward debt to current level
      (map-set staker-reward-debt tx-sender (* staked-balance accumulated))
      
      ;; Transfer rewards
      (as-contract (stx-transfer? pending-reward tx-sender tx-sender))
    )
  ))


;; Pause/unpause staking
(define-public (set-staking-status (enabled bool))
  (begin
    (asserts! (is-eq tx-sender (var-get protocol-owner)) ERR_UNAUTHORIZED)
    (var-set staking-enabled enabled)
    (ok true)))

;; Update protocol fee
(define-public (update-protocol-fee (new-fee-percent uint))
  (begin
    (asserts! (is-eq tx-sender (var-get protocol-owner)) ERR_UNAUTHORIZED)
    (asserts! (<= new-fee-percent u1000) ERR_INVALID_PARAMETER) ;; Max 10%
    (var-set protocol-fee-percent new-fee-percent)
    (ok true)))

;; Update cooldown period
(define-public (update-cooldown-period (blocks uint))
  (begin
    (asserts! (is-eq tx-sender (var-get protocol-owner)) ERR_UNAUTHORIZED)
    (var-set unstaking-cooldown-blocks blocks)
    (ok true)))

;; Read-only function to check pending rewards
(define-read-only (get-pending-rewards (staker principal))
  (let (
      (staked-balance (default-to u0 (map-get? staker-balances staker)))
      (reward-debt (default-to u0 (map-get? staker-reward-debt staker)))
      (accumulated (var-get accumulated-rewards-per-token))
      (pending-reward (/ (* staked-balance (- accumulated reward-debt)) (var-get exchange-rate-precision)))
    )
    pending-reward))

;; Read-only function to check unstaking request
(define-read-only (get-unstaking-request (staker principal))
  (map-get? unstaking-requests { staker: staker }))

;; Read-only function to get total protocol stats
(define-read-only (get-protocol-stats)
  {
    total-staked: (var-get total-staked-stx),
    total-liquid-tokens: (unwrap-panic (get-total-supply)),
    exchange-rate: (unwrap-panic (get-exchange-rate)),
    staking-enabled: (var-get staking-enabled),
    fee-percent: (var-get protocol-fee-percent),
    cooldown-blocks: (var-get unstaking-cooldown-blocks)
  })

;; Transfer protocol ownership
(define-public (transfer-ownership (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get protocol-owner)) ERR_UNAUTHORIZED)
    (var-set protocol-owner new-owner)
    (ok true)))
//! Sideband one-way payment channel (reference implementation).
//!
//! EXPERIMENTAL / NOT AUDITED. Testnet and synthetic assets only. Vouchers
//! are signed over the `Commitment` XDR of stellar-experimental/one-way-channel
//! (Apache-2.0), see docs/adr/0001. The lifecycle follows upstream's model
//! (top-up, partial settle, payer close with a dispute window, refund); see
//! docs/adr/0002 for where it still differs.
//!
//! Lifecycle:
//! - `init` (online): payer deposits; channel is `Open`.
//! - `top_up`: payer adds funds while `Open`.
//! - `settle`: provider withdraws up to the latest cumulative voucher; the
//!   channel stays open (long-running providers).
//! - `close`: provider withdraws up to its highest voucher and refunds the
//!   remainder to the payer in the same call; terminal (`Closed`).
//! - `close_start`: payer asks to close; the channel becomes `Closing` and the
//!   provider has `close_wait` seconds (and at least until `expires_at`) to
//!   `settle` / `close` with a higher voucher.
//! - `refund`: after the window, payer reclaims the unsettled balance;
//!   terminal (`Refunded`).
//!
//! Invariant (checked by the property test): `deposit == paid_to_provider +
//! refunded_to_payer + balance`, and the token balance held by the contract
//! equals `balance`.
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, symbol_short, token,
    xdr::ToXdr, Address, Bytes, BytesN, Env, Symbol,
};

/// Shortest allowed dispute window (seconds). Short enough for tests and
/// demos, long enough that a provider with intermittent connectivity is not
/// trivially front-run. Real deployments should pick hours, not minutes.
pub const MIN_CLOSE_WAIT: u64 = 60;
/// Longest allowed dispute window (31 days).
pub const MAX_CLOSE_WAIT: u64 = 31 * 24 * 60 * 60;

/// Instance TTL management (ledgers). ~5s per ledger.
const TTL_THRESHOLD: u32 = 17_280 * 7; // ~7 days
const TTL_EXTEND_TO: u32 = 17_280 * 30; // ~30 days

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidParams = 3,
    /// Channel is terminal (`Closed` or `Refunded`), or not `Open` for top-up.
    NotOpen = 4,
    /// Voucher amount above the total deposit.
    OverDeposit = 5,
    /// Dispute window (or expiry) has not elapsed yet.
    NotExpired = 6,
    /// Voucher amount not above what was already withdrawn.
    StaleVoucher = 7,
    /// `refund` before `close_start`.
    NotClosing = 8,
    /// Checked arithmetic overflowed.
    Overflow = 9,
    /// `close_start` called twice.
    AlreadyClosing = 10,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Status {
    Open,
    Closing,
    Closed,
    Refunded,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Channel {
    pub token: Address,
    pub payer: Address,
    pub provider: Address,
    /// Raw ed25519 key that signs vouchers (the payer commitment key).
    pub payer_key: BytesN<32>,
    /// Total ever deposited (init + top-ups).
    pub deposit: i128,
    /// Earliest time a payer-initiated close can complete (unix seconds).
    pub expires_at: u64,
    /// Dispute window after `close_start` (seconds).
    pub close_wait: u64,
    /// When `refund` becomes possible; 0 unless `Closing`.
    pub close_effective_at: u64,
    pub status: Status,
    /// Cumulative amount withdrawn by the provider (highest settled voucher).
    pub paid_to_provider: i128,
    pub refunded_to_payer: i128,
}

#[contracttype]
enum Key {
    Channel,
}

// ---- events (part of the contract spec, consumed by indexers/SDKs) ----

#[contractevent]
pub struct Opened {
    #[topic]
    pub payer: Address,
    #[topic]
    pub provider: Address,
    pub deposit: i128,
    pub expires_at: u64,
    pub close_wait: u64,
}

#[contractevent]
pub struct ToppedUp {
    #[topic]
    pub payer: Address,
    pub amount: i128,
    pub deposit: i128,
}

#[contractevent]
pub struct Settled {
    #[topic]
    pub provider: Address,
    /// Paid out by this call.
    pub amount: i128,
    /// Cumulative paid to the provider after this call.
    pub paid_to_provider: i128,
}

#[contractevent]
pub struct CloseStarted {
    #[topic]
    pub payer: Address,
    pub close_effective_at: u64,
}

#[contractevent]
pub struct Closed {
    #[topic]
    pub provider: Address,
    pub paid_to_provider: i128,
    pub refunded_to_payer: i128,
}

#[contractevent]
pub struct Refunded {
    #[topic]
    pub payer: Address,
    pub refunded_to_payer: i128,
    pub paid_to_provider: i128,
}

#[contract]
pub struct SidebandChannel;

fn load(env: &Env) -> Result<Channel, Error> {
    env.storage()
        .instance()
        .get(&Key::Channel)
        .ok_or(Error::NotInitialized)
}

fn store(env: &Env, ch: &Channel) {
    env.storage().instance().set(&Key::Channel, ch);
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn is_terminal(s: Status) -> bool {
    matches!(s, Status::Closed | Status::Refunded)
}

/// Unsettled funds still held for this channel.
fn remaining(ch: &Channel) -> Result<i128, Error> {
    ch.deposit
        .checked_sub(ch.paid_to_provider)
        .and_then(|v| v.checked_sub(ch.refunded_to_payer))
        .ok_or(Error::Overflow)
}

/// Same shape as upstream one-way-channel `Commitment`; soroban encodes the
/// struct as a map with keys sorted ascending: amount, channel, domain, network.
#[contracttype]
pub struct Commitment {
    domain: Symbol,
    network: BytesN<32>,
    channel: Address,
    amount: i128,
}

/// Bytes the payer signs for a cumulative `amount` on this channel.
pub fn voucher_preimage(env: &Env, cumulative: i128) -> Bytes {
    Commitment {
        domain: symbol_short!("chancmmt"),
        network: env.ledger().network_id(),
        channel: env.current_contract_address(),
        amount: cumulative,
    }
    .to_xdr(env)
}

/// Verifies `signature` over `cumulative` and pays the provider the delta
/// above what it already withdrew. Caller checks status and provider auth.
fn withdraw_to(
    env: &Env,
    ch: &mut Channel,
    cumulative: i128,
    signature: &BytesN<64>,
) -> Result<i128, Error> {
    if cumulative <= ch.paid_to_provider {
        return Err(Error::StaleVoucher);
    }
    if cumulative > ch.deposit {
        return Err(Error::OverDeposit);
    }
    let pre = voucher_preimage(env, cumulative);
    // Traps (aborts the whole invocation) on an invalid signature.
    env.crypto().ed25519_verify(&ch.payer_key, &pre, signature);
    let delta = cumulative
        .checked_sub(ch.paid_to_provider)
        .ok_or(Error::Overflow)?;
    token::Client::new(env, &ch.token).transfer(
        &env.current_contract_address(),
        &ch.provider,
        &delta,
    );
    ch.paid_to_provider = cumulative;
    Ok(delta)
}

#[contractimpl]
impl SidebandChannel {
    /// Online setup: payer funds the channel. Fails if already initialised.
    #[allow(clippy::too_many_arguments)]
    pub fn init(
        env: Env,
        token: Address,
        payer: Address,
        provider: Address,
        payer_key: BytesN<32>,
        deposit: i128,
        expires_at: u64,
        close_wait: u64,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&Key::Channel) {
            return Err(Error::AlreadyInitialized);
        }
        if deposit <= 0
            || expires_at <= env.ledger().timestamp()
            || !(MIN_CLOSE_WAIT..=MAX_CLOSE_WAIT).contains(&close_wait)
            || payer == provider
        {
            return Err(Error::InvalidParams);
        }
        payer.require_auth();
        token::Client::new(&env, &token).transfer(&payer, env.current_contract_address(), &deposit);
        let ch = Channel {
            token,
            payer: payer.clone(),
            provider: provider.clone(),
            payer_key,
            deposit,
            expires_at,
            close_wait,
            close_effective_at: 0,
            status: Status::Open,
            paid_to_provider: 0,
            refunded_to_payer: 0,
        };
        store(&env, &ch);
        Opened {
            payer,
            provider,
            deposit,
            expires_at,
            close_wait,
        }
        .publish(&env);
        Ok(())
    }

    /// Payer adds `amount` to an open channel.
    pub fn top_up(env: Env, amount: i128) -> Result<(), Error> {
        let mut ch = load(&env)?;
        if ch.status != Status::Open {
            return Err(Error::NotOpen);
        }
        ch.payer.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidParams);
        }
        ch.deposit = ch.deposit.checked_add(amount).ok_or(Error::Overflow)?;
        token::Client::new(&env, &ch.token).transfer(
            &ch.payer,
            env.current_contract_address(),
            &amount,
        );
        store(&env, &ch);
        ToppedUp {
            payer: ch.payer,
            amount,
            deposit: ch.deposit,
        }
        .publish(&env);
        Ok(())
    }

    /// Provider withdraws up to `cumulative` without closing. Allowed while
    /// `Open` or `Closing` (the dispute window). Returns the amount paid out.
    pub fn settle(env: Env, cumulative: i128, signature: BytesN<64>) -> Result<i128, Error> {
        let mut ch = load(&env)?;
        if is_terminal(ch.status) {
            return Err(Error::NotOpen);
        }
        ch.provider.require_auth();
        let delta = withdraw_to(&env, &mut ch, cumulative, &signature)?;
        store(&env, &ch);
        Settled {
            provider: ch.provider,
            amount: delta,
            paid_to_provider: ch.paid_to_provider,
        }
        .publish(&env);
        Ok(delta)
    }

    /// Provider closes: withdraws up to `cumulative` (if above what it already
    /// withdrew) and refunds the remainder to the payer. Terminal, so older or
    /// lower vouchers can never be replayed. Passing the already-withdrawn
    /// amount closes without a new voucher (the signature is then ignored).
    pub fn close(env: Env, cumulative: i128, signature: BytesN<64>) -> Result<(), Error> {
        let mut ch = load(&env)?;
        if is_terminal(ch.status) {
            return Err(Error::NotOpen);
        }
        ch.provider.require_auth();
        if cumulative > ch.paid_to_provider {
            withdraw_to(&env, &mut ch, cumulative, &signature)?;
        } else if cumulative < ch.paid_to_provider {
            return Err(Error::StaleVoucher);
        }
        let rest = remaining(&ch)?;
        if rest > 0 {
            token::Client::new(&env, &ch.token).transfer(
                &env.current_contract_address(),
                &ch.payer,
                &rest,
            );
        }
        ch.refunded_to_payer = ch
            .refunded_to_payer
            .checked_add(rest)
            .ok_or(Error::Overflow)?;
        ch.status = Status::Closed;
        store(&env, &ch);
        Closed {
            provider: ch.provider,
            paid_to_provider: ch.paid_to_provider,
            refunded_to_payer: ch.refunded_to_payer,
        }
        .publish(&env);
        Ok(())
    }

    /// Payer starts closing. `refund` becomes possible at
    /// `max(now + close_wait, expires_at)`; until then the provider can still
    /// `settle` or `close` with its highest voucher.
    pub fn close_start(env: Env) -> Result<u64, Error> {
        let mut ch = load(&env)?;
        match ch.status {
            Status::Open => {}
            Status::Closing => return Err(Error::AlreadyClosing),
            _ => return Err(Error::NotOpen),
        }
        ch.payer.require_auth();
        let after_wait = env
            .ledger()
            .timestamp()
            .checked_add(ch.close_wait)
            .ok_or(Error::Overflow)?;
        ch.close_effective_at = after_wait.max(ch.expires_at);
        ch.status = Status::Closing;
        store(&env, &ch);
        CloseStarted {
            payer: ch.payer.clone(),
            close_effective_at: ch.close_effective_at,
        }
        .publish(&env);
        Ok(ch.close_effective_at)
    }

    /// Payer reclaims the unsettled remainder after the dispute window.
    pub fn refund(env: Env) -> Result<i128, Error> {
        let mut ch = load(&env)?;
        match ch.status {
            Status::Closing => {}
            Status::Open => return Err(Error::NotClosing),
            _ => return Err(Error::NotOpen),
        }
        ch.payer.require_auth();
        if env.ledger().timestamp() < ch.close_effective_at {
            return Err(Error::NotExpired);
        }
        let rest = remaining(&ch)?;
        if rest > 0 {
            token::Client::new(&env, &ch.token).transfer(
                &env.current_contract_address(),
                &ch.payer,
                &rest,
            );
        }
        ch.refunded_to_payer = ch
            .refunded_to_payer
            .checked_add(rest)
            .ok_or(Error::Overflow)?;
        ch.status = Status::Refunded;
        store(&env, &ch);
        Refunded {
            payer: ch.payer,
            refunded_to_payer: ch.refunded_to_payer,
            paid_to_provider: ch.paid_to_provider,
        }
        .publish(&env);
        Ok(rest)
    }

    /// Full channel state.
    pub fn get(env: Env) -> Result<Channel, Error> {
        load(&env)
    }

    /// Unsettled funds still held for this channel.
    pub fn balance(env: Env) -> Result<i128, Error> {
        remaining(&load(&env)?)
    }

    pub fn status(env: Env) -> Result<Status, Error> {
        Ok(load(&env)?.status)
    }

    /// The exact bytes a payer must sign for `amount` (parity check for
    /// off-chain encoders, as upstream's `prepare_commitment`).
    pub fn prepare_commitment(env: Env, amount: i128) -> Bytes {
        voucher_preimage(&env, amount)
    }
}

#[cfg(test)]
mod test;

#[cfg(test)]
mod proptest_conservation;

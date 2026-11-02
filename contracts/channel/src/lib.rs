//! Sideband one-way payment channel (reference implementation).
//!
//! EXPERIMENTAL / NOT AUDITED. Testnet and synthetic assets only. The voucher
//! byte layout is `sideband-test-format-v1` (see docs/adr/0001) and is NOT
//! claimed compatible with stellar-experimental/one-way-channel.
//!
//! Lifecycle: `init` (payer deposits, while online) -> provider `close` with
//! the highest cumulative voucher (pays provider, refunds remainder) OR payer
//! `refund` after expiry if the provider never closed.
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, xdr::ToXdr, Address, Bytes, BytesN,
    Env,
};

const DOMAIN: &[u8] = b"sideband/voucher/v1";

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidParams = 3,
    NotOpen = 4,
    OverDeposit = 5,
    NotExpired = 6,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Status {
    Open,
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
    /// Raw ed25519 key of the provider; bound into the voucher domain.
    pub provider_key: BytesN<32>,
    pub deposit: i128,
    pub expires_at: u64,
    pub status: Status,
    pub paid_to_provider: i128,
    pub refunded_to_payer: i128,
}

#[contracttype]
enum Key {
    Channel,
}

#[contract]
pub struct SidebandChannel;

fn load(env: &Env) -> Result<Channel, Error> {
    env.storage()
        .instance()
        .get(&Key::Channel)
        .ok_or(Error::NotInitialized)
}

fn raw_contract_id(env: &Env) -> BytesN<32> {
    // ScVal(Address(Contract(hash))) XDR ends with the 32-byte contract hash.
    let xdr = env.current_contract_address().to_xdr(env);
    let n = xdr.len();
    let mut out = [0u8; 32];
    xdr.slice(n - 32..n).copy_into_slice(&mut out);
    BytesN::from_array(env, &out)
}

/// Builds the signed preimage. MUST match `buildPreimage` in the TS SDK.
pub fn voucher_preimage(env: &Env, ch: &Channel, cumulative: i128) -> Bytes {
    let mut b = Bytes::from_slice(env, DOMAIN);
    b.push_back(0);
    b.append(&Bytes::from(env.ledger().network_id()));
    b.append(&Bytes::from(raw_contract_id(env)));
    b.append(&Bytes::from(ch.payer_key.clone()));
    b.append(&Bytes::from(ch.provider_key.clone()));
    b.append(&Bytes::from_array(env, &(cumulative as u128).to_be_bytes()));
    b
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
        provider_key: BytesN<32>,
        deposit: i128,
        expires_at: u64,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&Key::Channel) {
            return Err(Error::AlreadyInitialized);
        }
        if deposit <= 0 || expires_at <= env.ledger().timestamp() {
            return Err(Error::InvalidParams);
        }
        payer.require_auth();
        token::Client::new(&env, &token).transfer(&payer, env.current_contract_address(), &deposit);
        env.storage().instance().set(
            &Key::Channel,
            &Channel {
                token,
                payer,
                provider,
                payer_key,
                provider_key,
                deposit,
                expires_at,
                status: Status::Open,
                paid_to_provider: 0,
                refunded_to_payer: 0,
            },
        );
        Ok(())
    }

    /// Provider settles with its highest voucher. Single-shot: after this the
    /// channel is Closed, so older/lower vouchers can never be replayed.
    pub fn close(env: Env, cumulative: i128, signature: BytesN<64>) -> Result<(), Error> {
        let mut ch = load(&env)?;
        if ch.status != Status::Open {
            return Err(Error::NotOpen);
        }
        ch.provider.require_auth();
        if cumulative <= 0 || cumulative > ch.deposit {
            return Err(Error::OverDeposit);
        }
        let pre = voucher_preimage(&env, &ch, cumulative);
        // Traps (aborts the invocation) on an invalid signature.
        env.crypto().ed25519_verify(&ch.payer_key, &pre, &signature);

        let t = token::Client::new(&env, &ch.token);
        let me = env.current_contract_address();
        t.transfer(&me, &ch.provider, &cumulative);
        let rest = ch.deposit - cumulative;
        if rest > 0 {
            t.transfer(&me, &ch.payer, &rest);
        }
        ch.status = Status::Closed;
        ch.paid_to_provider = cumulative;
        ch.refunded_to_payer = rest;
        env.storage().instance().set(&Key::Channel, &ch);
        Ok(())
    }

    /// Payer reclaims the whole deposit once expired, if never closed.
    pub fn refund(env: Env) -> Result<(), Error> {
        let mut ch = load(&env)?;
        if ch.status != Status::Open {
            return Err(Error::NotOpen);
        }
        ch.payer.require_auth();
        if env.ledger().timestamp() < ch.expires_at {
            return Err(Error::NotExpired);
        }
        token::Client::new(&env, &ch.token).transfer(
            &env.current_contract_address(),
            &ch.payer,
            &ch.deposit,
        );
        ch.status = Status::Refunded;
        ch.refunded_to_payer = ch.deposit;
        env.storage().instance().set(&Key::Channel, &ch);
        Ok(())
    }

    pub fn get(env: Env) -> Result<Channel, Error> {
        load(&env)
    }
}

#[cfg(test)]
mod test;

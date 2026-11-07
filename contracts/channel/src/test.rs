#![cfg(test)]
extern crate std;

use super::*;
use ed25519_dalek::{Signer, SigningKey};
use serde_json::Value;
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    xdr, Address, BytesN, Env,
};
use std::{fs, string::String, string::ToString, vec::Vec};

pub(crate) fn fixtures() -> Value {
    let p = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/voucher-vectors.json"
    );
    serde_json::from_str(&fs::read_to_string(p).expect("fixture")).expect("json")
}

fn b32(env: &Env, hexs: &str) -> BytesN<32> {
    let v: Vec<u8> = hex::decode(hexs).unwrap();
    BytesN::from_array(env, &v.try_into().unwrap())
}

fn b64(env: &Env, hexs: &str) -> BytesN<64> {
    let v: Vec<u8> = hex::decode(hexs).unwrap();
    BytesN::from_array(env, &v.try_into().unwrap())
}

/// The SYNTHETIC golden payer seed (`Buffer.alloc(32, 1)` in gen-fixtures.ts).
pub(crate) fn golden_payer_key() -> SigningKey {
    SigningKey::from_bytes(&[1u8; 32])
}

pub(crate) const MINT: i128 = 100_000_000_000;
pub(crate) const UNIT: i128 = 10_000_000;
pub(crate) const EXPIRES: u64 = 10_000;
pub(crate) const WAIT: u64 = 600;

pub(crate) struct Ctx<'a> {
    pub env: Env,
    pub addr: Address,
    pub client: SidebandChannelClient<'a>,
    pub token: TokenClient<'a>,
    pub payer: Address,
    pub provider: Address,
    pub fx: Value,
}

impl Ctx<'_> {
    /// Signs `amount` with the golden payer key over the contract's own
    /// `prepare_commitment` bytes.
    pub fn sign(&self, amount: i128) -> BytesN<64> {
        let pre = self.client.prepare_commitment(&amount);
        let mut buf = std::vec![0u8; pre.len() as usize];
        pre.copy_into_slice(&mut buf);
        BytesN::from_array(&self.env, &golden_payer_key().sign(&buf).to_bytes())
    }

    pub fn contract_balance(&self) -> i128 {
        self.token.balance(&self.addr)
    }

    pub fn set_time(&self, t: u64) {
        self.env.ledger().with_mut(|l| l.timestamp = t);
    }

    /// Topic names of the events emitted by the channel in the last call.
    pub fn event_names(&self) -> Vec<String> {
        self.env
            .events()
            .all()
            .filter_by_contract(&self.addr)
            .events()
            .iter()
            .map(|e| match &e.body {
                xdr::ContractEventBody::V0(b) => match b.topics.first() {
                    Some(xdr::ScVal::Symbol(s)) => String::from_utf8(s.0.to_vec()).unwrap(),
                    _ => String::new(),
                },
            })
            .collect()
    }
}

fn vector(fx: &Value, amount: &str) -> (i128, String) {
    for v in fx["vectors"].as_array().unwrap() {
        if v["cumulativeAmount"] == amount {
            return (
                v["cumulativeStroops"].as_str().unwrap().parse().unwrap(),
                v["signature"].as_str().unwrap().to_string(),
            );
        }
    }
    panic!("no vector {amount}");
}

/// Registers the channel at the golden contract id on the golden network so
/// the TS-generated vouchers verify. `network_hex`/`channel_hex` let tests
/// deliberately use the wrong domain.
pub(crate) fn setup_with<'a>(
    deposit: i128,
    network_hex: Option<&str>,
    channel_hex: Option<&str>,
) -> Ctx<'a> {
    let fx = fixtures();
    let env = Env::default();
    env.mock_all_auths();
    let net = network_hex.unwrap_or_else(|| fx["networkIdHex"].as_str().unwrap());
    env.ledger().with_mut(|l| {
        l.network_id = hex::decode(net).unwrap().try_into().unwrap();
        l.timestamp = 1_000;
    });
    let chan_hex = channel_hex.unwrap_or_else(|| fx["channelIdHex"].as_str().unwrap());
    let addr = Address::from_str(&env, &strkey_contract(chan_hex));
    env.register_at(&addr, SidebandChannel, ());
    let client = SidebandChannelClient::new(&env, &addr);

    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin);
    let token_addr = sac.address();
    let payer = Address::generate(&env);
    let provider = Address::generate(&env);
    StellarAssetClient::new(&env, &token_addr).mint(&payer, &MINT);
    let token = TokenClient::new(&env, &token_addr);

    client.init(
        &token_addr,
        &payer,
        &provider,
        &b32(&env, fx["payerPublicKeyHex"].as_str().unwrap()),
        &deposit,
        &EXPIRES,
        &WAIT,
    );
    Ctx {
        env,
        addr,
        client,
        token,
        payer,
        provider,
        fx,
    }
}

pub(crate) fn setup<'a>(deposit: i128) -> Ctx<'a> {
    setup_with(deposit, None, None)
}

/// Encodes a raw 32-byte contract id as a `C...` strkey (base32 + CRC16-XMODEM).
fn strkey_contract(raw_hex: &str) -> String {
    let raw = hex::decode(raw_hex).unwrap();
    let mut data = std::vec![2u8 << 3]; // contract version byte
    data.extend_from_slice(&raw);
    let mut crc: u16 = 0;
    for &b in &data {
        crc ^= (b as u16) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 {
                (crc << 1) ^ 0x1021
            } else {
                crc << 1
            };
        }
    }
    data.extend_from_slice(&crc.to_le_bytes());
    const A: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let (mut out, mut buf, mut bits) = (String::new(), 0u32, 0);
    for b in data {
        buf = (buf << 8) | b as u32;
        bits += 8;
        while bits >= 5 {
            out.push(A[((buf >> (bits - 5)) & 31) as usize] as char);
            bits -= 5;
        }
    }
    if bits > 0 {
        out.push(A[((buf << (5 - bits)) & 31) as usize] as char);
    }
    out
}

fn assert_conserved(c: &Ctx) {
    let ch = c.client.get();
    let bal = c.client.balance();
    assert_eq!(
        ch.deposit,
        ch.paid_to_provider + ch.refunded_to_payer + bal,
        "deposit == paid + refunded + balance"
    );
    assert_eq!(
        c.contract_balance(),
        bal,
        "token balance == channel balance"
    );
    assert_eq!(
        c.token.balance(&c.payer) + c.token.balance(&c.provider) + c.contract_balance(),
        MINT
    );
}

// ---------------------------------------------------------------- format parity

#[test]
fn strkey_helper_matches_fixture_channel_id() {
    let fx = fixtures();
    assert_eq!(
        strkey_contract(fx["channelIdHex"].as_str().unwrap()),
        fx["channelId"].as_str().unwrap()
    );
}

#[test]
fn prepare_commitment_matches_ts_golden_preimages() {
    let c = setup(10 * UNIT);
    for v in c.fx["vectors"].as_array().unwrap() {
        let amt: i128 = v["cumulativeStroops"].as_str().unwrap().parse().unwrap();
        let pre = c.client.prepare_commitment(&amt);
        let mut buf = std::vec![0u8; pre.len() as usize];
        pre.copy_into_slice(&mut buf);
        assert_eq!(hex::encode(&buf), v["preimageHex"].as_str().unwrap());
        // ed25519 is deterministic: our signer reproduces the TS signature.
        assert_eq!(
            hex::encode(c.sign(amt).to_array()),
            v["signature"].as_str().unwrap()
        );
    }
    assert_eq!(
        hex::encode(golden_payer_key().verifying_key().to_bytes()),
        c.fx["payerPublicKeyHex"].as_str().unwrap()
    );
}

// ---------------------------------------------------------------- init

#[test]
fn init_emits_opened_and_rejects_bad_params() {
    let c = setup(10 * UNIT);
    assert_eq!(c.event_names(), std::vec!["opened"]);
    let ch = c.client.get();
    assert_eq!(ch.status, Status::Open);
    assert_eq!(
        (ch.deposit, ch.close_wait, ch.close_effective_at),
        (10 * UNIT, WAIT, 0)
    );
    assert_eq!(c.client.balance(), 10 * UNIT);
    assert_eq!(c.client.status(), Status::Open);
    let k = b32(&c.env, c.fx["payerPublicKeyHex"].as_str().unwrap());
    let t = c.token.address.clone();
    assert_eq!(
        c.client
            .try_init(&t, &c.payer, &c.provider, &k, &UNIT, &20_000, &WAIT),
        Err(Ok(Error::AlreadyInitialized))
    );

    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000);
    let fresh = |env: &Env| {
        let id = env.register(SidebandChannel, ());
        SidebandChannelClient::new(env, &id)
    };
    let (p, q) = (Address::generate(&env), Address::generate(&env));
    let tok = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    let key = BytesN::from_array(&env, &[1u8; 32]);
    let bad = [
        (0i128, 5_000u64, WAIT, false),           // zero deposit
        (-1, 5_000, WAIT, false),                 // negative deposit
        (UNIT, 1_000, WAIT, false),               // already expired
        (UNIT, 5_000, MIN_CLOSE_WAIT - 1, false), // window too short
        (UNIT, 5_000, MAX_CLOSE_WAIT + 1, false), // window too long
        (UNIT, 5_000, WAIT, true),                // payer == provider
    ];
    for (dep, exp, wait, same) in bad {
        let cl = fresh(&env);
        let prov = if same { p.clone() } else { q.clone() };
        assert_eq!(
            cl.try_init(&tok, &p, &prov, &key, &dep, &exp, &wait),
            Err(Ok(Error::InvalidParams))
        );
    }
    // Uninitialised channel: every call reports NotInitialized.
    let cl = fresh(&env);
    assert_eq!(cl.try_get(), Err(Ok(Error::NotInitialized)));
    assert_eq!(cl.try_balance(), Err(Ok(Error::NotInitialized)));
    assert_eq!(cl.try_top_up(&UNIT), Err(Ok(Error::NotInitialized)));
    assert_eq!(cl.try_close_start(), Err(Ok(Error::NotInitialized)));
    assert_eq!(cl.try_refund(), Err(Ok(Error::NotInitialized)));
}

// ---------------------------------------------------------------- close (golden)

#[test]
fn close_with_golden_voucher_pays_provider_and_refunds_rest() {
    let c = setup(10 * UNIT);
    assert_eq!(c.token.balance(&c.payer), MINT - 10 * UNIT);
    let (amt, sig) = vector(&c.fx, "2.5");
    c.client.close(&amt, &b64(&c.env, &sig));
    assert_eq!(c.event_names(), std::vec!["closed"]);
    assert_eq!(c.token.balance(&c.provider), 25_000_000);
    assert_eq!(c.token.balance(&c.payer), MINT - 25_000_000);
    let ch = c.client.get();
    assert_eq!(ch.status, Status::Closed);
    assert_eq!(c.client.balance(), 0);
    assert_conserved(&c);
}

#[test]
fn tampered_amount_is_rejected() {
    let c = setup(10 * UNIT);
    let (_, sig) = vector(&c.fx, "2.5");
    assert!(c.client.try_close(&(3 * UNIT), &b64(&c.env, &sig)).is_err());
    assert!(c
        .client
        .try_settle(&(3 * UNIT), &b64(&c.env, &sig))
        .is_err());
    assert_eq!(c.client.get().status, Status::Open);
    assert_conserved(&c);
}

#[test]
fn voucher_for_wrong_network_is_rejected() {
    let other = "11".repeat(32);
    let c = setup_with(10 * UNIT, Some(&other), None);
    let (amt, sig) = vector(&c.fx, "1");
    assert!(c.client.try_close(&amt, &b64(&c.env, &sig)).is_err());
    assert!(c.client.try_settle(&amt, &b64(&c.env, &sig)).is_err());
    assert_eq!(c.client.get().status, Status::Open);
}

#[test]
fn voucher_for_wrong_channel_is_rejected() {
    let other = "0a".repeat(32);
    let c = setup_with(10 * UNIT, None, Some(&other));
    let (amt, sig) = vector(&c.fx, "1");
    assert!(c.client.try_close(&amt, &b64(&c.env, &sig)).is_err());
    assert!(c.client.try_settle(&amt, &b64(&c.env, &sig)).is_err());
    assert_eq!(c.client.get().paid_to_provider, 0);
}

#[test]
fn over_deposit_voucher_is_rejected() {
    let c = setup(5 * UNIT);
    let (amt, sig) = vector(&c.fx, "10");
    assert_eq!(
        c.client.try_close(&amt, &b64(&c.env, &sig)),
        Err(Ok(Error::OverDeposit))
    );
    assert_eq!(
        c.client.try_settle(&amt, &b64(&c.env, &sig)),
        Err(Ok(Error::OverDeposit))
    );
    assert_eq!(c.client.get().status, Status::Open);
}

#[test]
fn terminal_channel_refuses_every_mutation() {
    let c = setup(10 * UNIT);
    let (hi, hi_sig) = vector(&c.fx, "2.5");
    let (lo, lo_sig) = vector(&c.fx, "1");
    c.client.close(&hi, &b64(&c.env, &hi_sig));
    assert_eq!(
        c.client.try_close(&lo, &b64(&c.env, &lo_sig)),
        Err(Ok(Error::NotOpen))
    );
    assert_eq!(
        c.client.try_close(&hi, &b64(&c.env, &hi_sig)),
        Err(Ok(Error::NotOpen))
    );
    assert_eq!(
        c.client.try_settle(&(3 * UNIT), &c.sign(3 * UNIT)),
        Err(Ok(Error::NotOpen))
    );
    assert_eq!(c.client.try_top_up(&UNIT), Err(Ok(Error::NotOpen)));
    assert_eq!(c.client.try_close_start(), Err(Ok(Error::NotOpen)));
    assert_eq!(c.client.try_refund(), Err(Ok(Error::NotOpen)));
    assert_eq!(c.token.balance(&c.provider), 25_000_000);
    assert_conserved(&c);
}

// ---------------------------------------------------------------- settle

#[test]
fn settle_withdraws_deltas_and_keeps_channel_open() {
    let c = setup(10 * UNIT);
    assert_eq!(c.client.settle(&UNIT, &c.sign(UNIT)), UNIT);
    assert_eq!(c.event_names(), std::vec!["settled"]);
    assert_eq!(c.client.settle(&(4 * UNIT), &c.sign(4 * UNIT)), 3 * UNIT);
    let ch = c.client.get();
    assert_eq!((ch.status, ch.paid_to_provider), (Status::Open, 4 * UNIT));
    assert_eq!(c.token.balance(&c.provider), 4 * UNIT);
    assert_eq!(c.client.balance(), 6 * UNIT);
    assert_conserved(&c);

    // Equal or lower vouchers are stale: no double pay, no rollback.
    assert_eq!(
        c.client.try_settle(&(4 * UNIT), &c.sign(4 * UNIT)),
        Err(Ok(Error::StaleVoucher))
    );
    assert_eq!(
        c.client.try_settle(&UNIT, &c.sign(UNIT)),
        Err(Ok(Error::StaleVoucher))
    );
    assert_eq!(
        c.client.try_settle(&0, &c.sign(0)),
        Err(Ok(Error::StaleVoucher))
    );
    assert_eq!(
        c.client.try_close(&UNIT, &c.sign(UNIT)),
        Err(Ok(Error::StaleVoucher))
    );

    // Closing with the already-withdrawn amount needs no new voucher.
    let junk = BytesN::from_array(&c.env, &[0u8; 64]);
    c.client.close(&(4 * UNIT), &junk);
    let ch = c.client.get();
    assert_eq!(
        (ch.status, ch.refunded_to_payer),
        (Status::Closed, 6 * UNIT)
    );
    assert_eq!(c.token.balance(&c.payer), MINT - 4 * UNIT);
    assert_conserved(&c);
}

#[test]
fn provider_can_close_with_zero_and_refund_everything() {
    let c = setup(10 * UNIT);
    c.client.close(&0, &BytesN::from_array(&c.env, &[0u8; 64]));
    assert_eq!(c.token.balance(&c.payer), MINT);
    assert_eq!(c.client.get().status, Status::Closed);
    assert_conserved(&c);
}

// ---------------------------------------------------------------- top_up

#[test]
fn top_up_raises_the_deposit_so_higher_vouchers_settle() {
    let c = setup(2 * UNIT);
    let sig5 = c.sign(5 * UNIT);
    assert_eq!(
        c.client.try_settle(&(5 * UNIT), &sig5),
        Err(Ok(Error::OverDeposit))
    );
    c.client.top_up(&(3 * UNIT));
    assert_eq!(c.event_names(), std::vec!["topped_up"]);
    assert_eq!(c.client.get().deposit, 5 * UNIT);
    assert_eq!(c.token.balance(&c.payer), MINT - 5 * UNIT);
    assert_eq!(c.client.settle(&(5 * UNIT), &sig5), 5 * UNIT);
    assert_eq!(c.client.balance(), 0);
    assert_conserved(&c);
    assert_eq!(c.client.try_top_up(&0), Err(Ok(Error::InvalidParams)));
    assert_eq!(c.client.try_top_up(&-5), Err(Ok(Error::InvalidParams)));
}

#[test]
fn top_up_overflow_is_an_error_not_a_wrap() {
    let c = setup(10 * UNIT);
    assert_eq!(c.client.try_top_up(&i128::MAX), Err(Ok(Error::Overflow)));
    assert_eq!(c.client.get().deposit, 10 * UNIT);
}

#[test]
fn top_up_is_refused_once_closing() {
    let c = setup(10 * UNIT);
    c.client.close_start();
    assert_eq!(c.client.try_top_up(&UNIT), Err(Ok(Error::NotOpen)));
}

// ---------------------------------------------------------------- close_start / refund

#[test]
fn payer_close_has_a_dispute_window_for_a_higher_voucher() {
    let c = setup(10 * UNIT);
    c.client.settle(&UNIT, &c.sign(UNIT));
    c.set_time(9_800); // window would end at 10_400 > expires_at
    assert_eq!(c.client.close_start(), 9_800 + WAIT);
    assert_eq!(c.event_names(), std::vec!["close_started"]);
    let ch = c.client.get();
    assert_eq!(
        (ch.status, ch.close_effective_at),
        (Status::Closing, 10_400)
    );
    assert_eq!(c.client.try_close_start(), Err(Ok(Error::AlreadyClosing)));
    assert_eq!(c.client.try_refund(), Err(Ok(Error::NotExpired)));
    c.set_time(10_399);
    assert_eq!(c.client.try_refund(), Err(Ok(Error::NotExpired)));

    // Provider disputes inside the window with its highest voucher.
    assert_eq!(c.client.settle(&(3 * UNIT), &c.sign(3 * UNIT)), 2 * UNIT);
    assert_eq!(c.client.get().status, Status::Closing);

    c.set_time(10_400);
    assert_eq!(c.client.refund(), 7 * UNIT);
    assert_eq!(c.event_names(), std::vec!["refunded"]);
    let ch = c.client.get();
    assert_eq!(ch.status, Status::Refunded);
    assert_eq!(
        (ch.paid_to_provider, ch.refunded_to_payer),
        (3 * UNIT, 7 * UNIT)
    );
    assert_eq!(c.token.balance(&c.provider), 3 * UNIT);
    assert_eq!(c.token.balance(&c.payer), MINT - 3 * UNIT);
    assert_conserved(&c);
    // Late vouchers cannot pull funds after the refund.
    assert_eq!(
        c.client.try_settle(&(5 * UNIT), &c.sign(5 * UNIT)),
        Err(Ok(Error::NotOpen))
    );
    assert_eq!(c.client.try_refund(), Err(Ok(Error::NotOpen)));
}

#[test]
fn close_effective_at_is_never_before_expiry() {
    let c = setup(10 * UNIT);
    assert_eq!(c.client.close_start(), EXPIRES); // 1_000 + 600 < 10_000
    c.set_time(EXPIRES - 1);
    assert_eq!(c.client.try_refund(), Err(Ok(Error::NotExpired)));
    c.set_time(EXPIRES);
    assert_eq!(c.client.refund(), 10 * UNIT);
    assert_eq!(c.token.balance(&c.payer), MINT);
    assert_conserved(&c);
}

#[test]
fn provider_can_close_during_the_window() {
    let c = setup(10 * UNIT);
    c.client.close_start();
    let (amt, sig) = vector(&c.fx, "2.5");
    c.client.close(&amt, &b64(&c.env, &sig));
    let ch = c.client.get();
    assert_eq!(ch.status, Status::Closed);
    assert_eq!(ch.refunded_to_payer, 10 * UNIT - amt);
    c.set_time(EXPIRES + WAIT);
    assert_eq!(c.client.try_refund(), Err(Ok(Error::NotOpen)));
    assert_conserved(&c);
}

#[test]
fn refund_requires_close_start() {
    let c = setup(10 * UNIT);
    c.set_time(EXPIRES * 10);
    assert_eq!(c.client.try_refund(), Err(Ok(Error::NotClosing)));
}

#[test]
fn close_start_overflow_is_an_error() {
    let c = setup(10 * UNIT);
    c.set_time(u64::MAX - 1);
    assert_eq!(c.client.try_close_start(), Err(Ok(Error::Overflow)));
    assert_eq!(c.client.get().status, Status::Open);
}

// ---------------------------------------------------------------- auth

fn last_auth_signer(c: &Ctx) -> Address {
    let auths = c.env.auths();
    assert_eq!(auths.len(), 1, "exactly one authorizer");
    auths[0].0.clone()
}

#[test]
fn every_mutation_requires_the_right_party() {
    let c = setup(10 * UNIT);
    assert_eq!(c.env.auths().len(), 1);
    assert_eq!(c.env.auths()[0].0, c.payer); // init by payer

    c.client.top_up(&UNIT);
    assert_eq!(last_auth_signer(&c), c.payer);
    c.client.settle(&UNIT, &c.sign(UNIT));
    assert_eq!(last_auth_signer(&c), c.provider);
    c.client.close_start();
    assert_eq!(last_auth_signer(&c), c.payer);
    c.set_time(EXPIRES);
    c.client.refund();
    assert_eq!(last_auth_signer(&c), c.payer);

    let c = setup(10 * UNIT);
    c.client.close(&UNIT, &c.sign(UNIT));
    assert_eq!(last_auth_signer(&c), c.provider);
}

#[test]
fn calls_without_authorization_fail_and_change_nothing() {
    let c = setup(10 * UNIT);
    c.env.set_auths(&[]); // drop mock_all_auths: nobody has signed anything
    assert!(c.client.try_top_up(&UNIT).is_err());
    assert!(c.client.try_settle(&UNIT, &c.sign(UNIT)).is_err());
    assert!(c.client.try_close(&UNIT, &c.sign(UNIT)).is_err());
    assert!(c.client.try_close_start().is_err());
    let ch = c.client.get();
    assert_eq!(
        (ch.status, ch.deposit, ch.paid_to_provider),
        (Status::Open, 10 * UNIT, 0)
    );
    assert_conserved(&c);
}

#[test]
fn the_wrong_party_cannot_act_for_the_other() {
    use soroban_sdk::{testutils::MockAuth, testutils::MockAuthInvoke, IntoVal};
    let c = setup(10 * UNIT);
    // Provider signs a close_start: only the payer may start a close.
    c.env.mock_auths(&[MockAuth {
        address: &c.provider,
        invoke: &MockAuthInvoke {
            contract: &c.addr,
            fn_name: "close_start",
            args: ().into_val(&c.env),
            sub_invokes: &[],
        },
    }]);
    assert!(c.client.try_close_start().is_err());
    // Payer signs a settle: only the provider may withdraw.
    let sig = c.sign(UNIT);
    c.env.mock_auths(&[MockAuth {
        address: &c.payer,
        invoke: &MockAuthInvoke {
            contract: &c.addr,
            fn_name: "settle",
            args: (UNIT, sig.clone()).into_val(&c.env),
            sub_invokes: &[],
        },
    }]);
    assert!(c.client.try_settle(&UNIT, &sig).is_err());
    assert_eq!(c.client.get().status, Status::Open);
    assert_eq!(c.client.get().paid_to_provider, 0);
}

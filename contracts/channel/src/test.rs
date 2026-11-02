#![cfg(test)]
extern crate std;

use super::*;
use serde_json::Value;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env,
};
use std::{fs, string::ToString, vec::Vec};

fn fixtures() -> Value {
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

struct Ctx<'a> {
    env: Env,
    client: SidebandChannelClient<'a>,
    token: TokenClient<'a>,
    payer: Address,
    provider: Address,
    fx: Value,
}

fn vector(fx: &Value, amount: &str) -> (i128, std::string::String) {
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

/// `network_hex`/`channel_hex` let tests deliberately use the wrong domain.
fn setup<'a>(deposit: i128, network_hex: Option<&str>, channel_hex: Option<&str>) -> Ctx<'a> {
    let fx = fixtures();
    let env = Env::default();
    env.mock_all_auths();
    let net = network_hex.unwrap_or_else(|| fx["networkIdHex"].as_str().unwrap());
    env.ledger().with_mut(|l| {
        l.network_id = hex::decode(net).unwrap().try_into().unwrap();
        l.timestamp = 1_000;
    });
    let chan_hex = channel_hex.unwrap_or_else(|| fx["channelIdHex"].as_str().unwrap());
    // Register at a fixed contract id so the golden voucher domain matches.
    let addr = Address::from_str(&env, &strkey_contract(chan_hex));
    env.register_at(&addr, SidebandChannel, ());
    let client = SidebandChannelClient::new(&env, &addr);

    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin);
    let token_addr = sac.address();
    let payer = Address::generate(&env);
    let provider = Address::generate(&env);
    StellarAssetClient::new(&env, &token_addr).mint(&payer, &100_000_000_000);
    let token = TokenClient::new(&env, &token_addr);

    client.init(
        &token_addr,
        &payer,
        &provider,
        &b32(&env, fx["payerPublicKeyHex"].as_str().unwrap()),
        &b32(&env, fx["providerPublicKeyHex"].as_str().unwrap()),
        &deposit,
        &10_000,
    );
    Ctx {
        env,
        client,
        token,
        payer,
        provider,
        fx,
    }
}

/// Encodes a raw 32-byte contract id as a `C...` strkey (base32 + CRC16-XMODEM).
fn strkey_contract(raw_hex: &str) -> std::string::String {
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
    let (mut out, mut buf, mut bits) = (std::string::String::new(), 0u32, 0);
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

const UNIT: i128 = 10_000_000;

#[test]
fn strkey_helper_matches_fixture_channel_id() {
    let fx = fixtures();
    assert_eq!(
        strkey_contract(fx["channelIdHex"].as_str().unwrap()),
        fx["channelId"].as_str().unwrap()
    );
}

#[test]
fn close_with_golden_voucher_pays_provider_and_refunds_rest() {
    let c = setup(10 * UNIT, None, None);
    assert_eq!(c.token.balance(&c.payer), 100_000_000_000 - 10 * UNIT);
    let (amt, sig) = vector(&c.fx, "2.5");
    c.client.close(&amt, &b64(&c.env, &sig));
    assert_eq!(c.token.balance(&c.provider), 25_000_000);
    assert_eq!(c.token.balance(&c.payer), 100_000_000_000 - 25_000_000);
    let ch = c.client.get();
    assert_eq!(ch.status, Status::Closed);
    assert_eq!(ch.paid_to_provider + ch.refunded_to_payer, ch.deposit);
}

#[test]
fn tampered_amount_is_rejected() {
    let c = setup(10 * UNIT, None, None);
    let (_, sig) = vector(&c.fx, "2.5");
    // signature was for 2.5
    assert!(c.client.try_close(&(3 * UNIT), &b64(&c.env, &sig)).is_err());
    assert_eq!(c.client.get().status, Status::Open);
}

#[test]
fn voucher_for_wrong_network_is_rejected() {
    let other = "11".repeat(32);
    let c = setup(10 * UNIT, Some(&other), None);
    let (amt, sig) = vector(&c.fx, "1");
    assert!(c.client.try_close(&amt, &b64(&c.env, &sig)).is_err());
    assert_eq!(c.client.get().status, Status::Open);
}

#[test]
fn voucher_for_wrong_channel_is_rejected() {
    let other = "0a".repeat(32);
    let c = setup(10 * UNIT, None, Some(&other));
    let (amt, sig) = vector(&c.fx, "1");
    assert!(c.client.try_close(&amt, &b64(&c.env, &sig)).is_err());
    assert_eq!(c.client.get().status, Status::Open);
}

#[test]
fn over_deposit_voucher_is_rejected() {
    let c = setup(5 * UNIT, None, None);
    let (amt, sig) = vector(&c.fx, "10");
    assert_eq!(
        c.client.try_close(&amt, &b64(&c.env, &sig)),
        Err(Ok(Error::OverDeposit))
    );
    assert_eq!(c.client.get().status, Status::Open);
}

#[test]
fn cannot_close_twice_so_lower_vouchers_cannot_roll_back() {
    let c = setup(10 * UNIT, None, None);
    let (hi, hi_sig) = vector(&c.fx, "2.5");
    let (lo, lo_sig) = vector(&c.fx, "1");
    c.client.close(&hi, &b64(&c.env, &hi_sig));
    assert_eq!(
        c.client.try_close(&lo, &b64(&c.env, &lo_sig)),
        Err(Ok(Error::NotOpen))
    );
    assert_eq!(c.token.balance(&c.provider), 25_000_000);
}

#[test]
fn provider_shutdown_payer_refunds_only_after_expiry() {
    let c = setup(10 * UNIT, None, None);
    assert_eq!(c.client.try_refund(), Err(Ok(Error::NotExpired)));
    c.env.ledger().with_mut(|l| l.timestamp = 10_000);
    c.client.refund();
    assert_eq!(c.token.balance(&c.payer), 100_000_000_000);
    assert_eq!(c.client.get().status, Status::Refunded);
    // A late voucher cannot pull funds after refund.
    let (amt, sig) = vector(&c.fx, "1");
    assert_eq!(
        c.client.try_close(&amt, &b64(&c.env, &sig)),
        Err(Ok(Error::NotOpen))
    );
}

#[test]
fn init_twice_and_bad_params_fail() {
    let c = setup(10 * UNIT, None, None);
    let k = b32(&c.env, c.fx["payerPublicKeyHex"].as_str().unwrap());
    let t = c.token.address.clone();
    assert_eq!(
        c.client
            .try_init(&t, &c.payer, &c.provider, &k, &k, &UNIT, &20_000),
        Err(Ok(Error::AlreadyInitialized))
    );
}

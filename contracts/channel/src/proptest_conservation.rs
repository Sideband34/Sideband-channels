//! Property test: funds are conserved across arbitrary call sequences.
//!
//! For any interleaving of top-ups, settles, closes, close starts, refunds and
//! clock moves (valid or not), after every step:
//! `deposit == paid_to_provider + refunded_to_payer + balance`, the token
//! balance held by the contract equals `balance`, nobody's tokens appear or
//! vanish, the provider's withdrawn amount never decreases, and a terminal
//! channel never changes again.
#![cfg(test)]
extern crate std;

use super::test::{setup, Ctx, MINT, UNIT, WAIT};
use super::*;
use proptest::prelude::*;
use soroban_sdk::BytesN;

#[derive(Clone, Debug)]
enum Op {
    TopUp(i128),
    Settle(i128),
    Close(i128),
    /// Provider presents a signature for a different amount.
    ForgedSettle(i128),
    CloseStart,
    Refund,
    Advance(u64),
}

fn op() -> impl Strategy<Value = Op> {
    prop_oneof![
        (1i128..=5 * UNIT).prop_map(Op::TopUp),
        (0i128..=20 * UNIT).prop_map(Op::Settle),
        (0i128..=20 * UNIT).prop_map(Op::Close),
        (1i128..=20 * UNIT).prop_map(Op::ForgedSettle),
        Just(Op::CloseStart),
        Just(Op::Refund),
        (0u64..=2 * WAIT).prop_map(Op::Advance),
    ]
}

fn snapshot(c: &Ctx) -> (Channel, i128) {
    (c.client.get(), c.client.balance())
}

fn check(c: &Ctx, before: &(Channel, i128)) {
    let (ch, bal) = snapshot(c);
    assert!(bal >= 0);
    assert_eq!(ch.deposit, ch.paid_to_provider + ch.refunded_to_payer + bal);
    assert_eq!(c.contract_balance(), bal);
    assert_eq!(
        c.token.balance(&c.payer) + c.token.balance(&c.provider) + c.contract_balance(),
        MINT
    );
    assert_eq!(c.token.balance(&c.provider), ch.paid_to_provider);
    assert!(ch.paid_to_provider >= before.0.paid_to_provider);
    assert!(ch.paid_to_provider <= ch.deposit);
    if matches!(before.0.status, Status::Closed | Status::Refunded) {
        assert_eq!(&ch, &before.0, "terminal channel changed");
    }
    if matches!(ch.status, Status::Closed | Status::Refunded) {
        assert_eq!(bal, 0);
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 48, ..ProptestConfig::default() })]
    #[test]
    fn funds_are_conserved(deposit in 1i128..=10 * UNIT, ops in prop::collection::vec(op(), 1..14)) {
        let c = setup(deposit);
        let mut now = 1_000u64;
        for o in ops {
            let before = snapshot(&c);
            match o {
                Op::TopUp(a) => { let _ = c.client.try_top_up(&a); }
                Op::Settle(a) => { let _ = c.client.try_settle(&a, &c.sign(a)); }
                Op::Close(a) => { let _ = c.client.try_close(&a, &c.sign(a)); }
                Op::ForgedSettle(a) => {
                    let sig: BytesN<64> = c.sign(a + 1);
                    let r = c.client.try_settle(&a, &sig);
                    prop_assert!(r.is_err());
                }
                Op::CloseStart => { let _ = c.client.try_close_start(); }
                Op::Refund => { let _ = c.client.try_refund(); }
                Op::Advance(d) => { now += d; c.set_time(now); }
            }
            check(&c, &before);
        }
    }
}

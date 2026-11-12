//! Mock USDC: a NEP-141 fungible token with 6 decimals and an open faucet.
//!
//! For sandbox and testnet only. Anyone may call `mint`, so the token has no value.

use near_contract_standards::fungible_token::events::FtMint;
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue,
};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    token: FungibleToken,
}

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    Token,
}

#[near]
impl Contract {
    #[init]
    pub fn new() -> Self {
        Self {
            token: FungibleToken::new(StorageKey::Token),
        }
    }

    /// Faucet: mint `amount` (6-dp minor units) to `account_id`. Callable by anyone.
    /// Registers the account if needed; the contract pays for that storage.
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        require!(amount.0 > 0, "amount must be positive");
        if !self.token.accounts.contains_key(&account_id) {
            self.token.internal_register_account(&account_id);
        }
        self.token.internal_deposit(&account_id, amount.0);
        FtMint {
            owner_id: &account_id,
            amount,
            memo: Some("faucet"),
        }
        .emit();
    }
}

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used_amount, _burned) =
            self.token
                .internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used_amount.into()
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        #[allow(unused_variables)]
        if let Some((account_id, balance)) = self.token.internal_storage_unregister(force) {
            env::log_str(&format!("Closed @{account_id} with {balance}"));
            true
        } else {
            false
        }
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Mock USDC".to_string(),
            symbol: "USDC".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    #[test]
    fn mint_registers_and_credits() {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(acc("anyone.near"))
            .build());
        let mut c = Contract::new();
        c.mint(acc("alice.near"), U128(1_500_000));
        c.mint(acc("alice.near"), U128(500_000));
        assert_eq!(c.ft_balance_of(acc("alice.near")).0, 2_000_000);
        assert_eq!(c.ft_total_supply().0, 2_000_000);
        assert!(c.storage_balance_of(acc("alice.near")).is_some());
        assert!(c.storage_balance_of(acc("bob.near")).is_none());
    }

    #[test]
    fn metadata() {
        testing_env!(VMContextBuilder::new().build());
        let c = Contract::new();
        let m = c.ft_metadata();
        assert_eq!((m.decimals, m.symbol.as_str(), m.name.as_str()), (6, "USDC", "Mock USDC"));
    }

    #[test]
    #[should_panic(expected = "is not registered")]
    fn transfer_to_unregistered_fails() {
        testing_env!(VMContextBuilder::new().build());
        let mut c = Contract::new();
        c.mint(acc("alice.near"), U128(10));
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(acc("alice.near"))
            .attached_deposit(NearToken::from_yoctonear(1))
            .build());
        c.ft_transfer(acc("bob.near"), U128(5), None);
    }
}

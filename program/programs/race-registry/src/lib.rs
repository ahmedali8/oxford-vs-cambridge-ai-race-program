pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use instructions::*;

declare_id!("6BtrL31HhC3LLZJeqhHWcFHh6w44dwCYE5tpgAbiT4RD");

#[program]
pub mod race_registry {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, code_window_slots: u64) -> Result<()> {
        instructions::initialize::handle_initialize(ctx, code_window_slots)
    }

    pub fn init_team(ctx: Context<InitTeam>, team_id: String, clearance_nonce: u64) -> Result<()> {
        instructions::init_team::handle_init_team(ctx, team_id, clearance_nonce)
    }

    pub fn init_team_holdings(
        ctx: Context<InitTeamHoldings>,
        team_id: String,
        registrar_key: Pubkey,
    ) -> Result<()> {
        instructions::init_team_holdings::handle_init_team_holdings(ctx, team_id, registrar_key)
    }

    pub fn mint_code(ctx: Context<MintCode>, team_id: String, memo_hash: [u8; 32]) -> Result<()> {
        instructions::mint_code::handle_mint_code(ctx, team_id, memo_hash)
    }
}

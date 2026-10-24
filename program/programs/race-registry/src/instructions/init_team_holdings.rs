use anchor_lang::prelude::*;

use crate::{
    constants::{CONFIG_SEED, HOLDINGS_SEED, MAX_TEAM_ID_LEN},
    error::ErrorCode,
    state::{Config, TeamHoldings},
};

#[derive(Accounts)]
#[instruction(team_id: String)]
pub struct InitTeamHoldings<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = authority,
        space = 8 + TeamHoldings::INIT_SPACE,
        seeds = [HOLDINGS_SEED, team_id.as_bytes()],
        bump
    )]
    pub holdings: Account<'info, TeamHoldings>,
    pub system_program: Program<'info, System>,
}

pub fn handle_init_team_holdings(
    ctx: Context<InitTeamHoldings>,
    team_id: String,
    registrar_key: Pubkey,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.config.authority,
        ctx.accounts.authority.key(),
        ErrorCode::Unauthorized
    );
    require!(
        !team_id.is_empty() && team_id.len() <= MAX_TEAM_ID_LEN,
        ErrorCode::InvalidTeamId
    );

    ctx.accounts.holdings.registrar_key = registrar_key;
    ctx.accounts.holdings.codes_minted = 0;
    Ok(())
}

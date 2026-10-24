use anchor_lang::prelude::*;

use crate::{
    constants::{CONFIG_SEED, MAX_TEAM_ID_LEN, TEAM_SEED},
    error::ErrorCode,
    state::{Config, VerificationRecord},
};

#[derive(Accounts)]
#[instruction(team_id: String)]
pub struct InitTeam<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = authority,
        space = 8 + VerificationRecord::INIT_SPACE,
        seeds = [TEAM_SEED, team_id.to_lowercase().as_bytes()],
        bump
    )]
    pub verification_record: Account<'info, VerificationRecord>,
    /// CHECK: Stored as the team's payment destination; never read or written here.
    pub clearance_ata: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_init_team(ctx: Context<InitTeam>, team_id: String, clearance_nonce: u64) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.config.authority,
        ctx.accounts.authority.key(),
        ErrorCode::Unauthorized
    );
    require!(
        !team_id.is_empty() && team_id.len() <= MAX_TEAM_ID_LEN,
        ErrorCode::InvalidTeamId
    );

    let record = &mut ctx.accounts.verification_record;
    record.verifier = ctx.accounts.authority.key();
    record.status = 0;
    record.clearance_nonce = clearance_nonce;
    record.clearance_ata = ctx.accounts.clearance_ata.key();
    Ok(())
}

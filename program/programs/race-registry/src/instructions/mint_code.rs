use anchor_lang::prelude::*;
use solana_instructions_sysvar::{self as instructions, load_instruction_at_checked};
use solana_sha256_hasher::hashv;

use crate::{
    constants::{CLEARANCE_SEED, HOLDINGS_SEED, MAX_TEAM_ID_LEN, MEMO_PROGRAM_ID},
    error::ErrorCode,
    state::{ClearanceRecord, TeamHoldings},
};

#[derive(Accounts)]
#[instruction(team_id: String)]
pub struct MintCode<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [HOLDINGS_SEED, team_id.as_bytes()],
        bump
    )]
    pub holdings: Account<'info, TeamHoldings>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + ClearanceRecord::INIT_SPACE,
        seeds = [CLEARANCE_SEED, team_id.as_bytes()],
        bump
    )]
    pub clearance_record: Account<'info, ClearanceRecord>,
    /// CHECK: Address-constrained to the Instructions sysvar.
    #[account(address = instructions::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_mint_code(ctx: Context<MintCode>, team_id: String, memo_hash: [u8; 32]) -> Result<()> {
    require!(
        !team_id.is_empty() && team_id.len() <= MAX_TEAM_ID_LEN,
        ErrorCode::InvalidTeamId
    );

    // Witness check: the registrar recorded in the holdings must be passed as the first
    // remaining account. It does not need to sign.
    let registrar = ctx
        .remaining_accounts
        .first()
        .ok_or_else(|| error!(ErrorCode::RegistrarMissing))?;
    require_keys_eq!(
        registrar.key(),
        ctx.accounts.holdings.registrar_key,
        ErrorCode::RegistrarMissing
    );
    require!(
        memo_is_present(&ctx.accounts.instructions_sysvar, &memo_hash)?,
        ErrorCode::MemoMissing
    );

    let issued_slot = Clock::get()?.slot;
    let digest = hashv(&[team_id.as_bytes(), &memo_hash, &issued_slot.to_le_bytes()]);
    let encoded = bs58::encode(digest.to_bytes()).into_string();
    let clearance_code: [u8; 8] = encoded.as_bytes()[..8]
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let record = &mut ctx.accounts.clearance_record;
    record.team = team_id;
    record.clearance_code = clearance_code;
    record.issued_slot = issued_slot;
    record.presented = false;
    ctx.accounts.holdings.codes_minted = ctx.accounts.holdings.codes_minted.wrapping_add(1);
    Ok(())
}

/// True when any instruction in this transaction is an SPL Memo whose data is the lowercase hex
/// of `memo_hash`.
fn memo_is_present(instructions_account: &AccountInfo<'_>, memo_hash: &[u8; 32]) -> Result<bool> {
    let expected = lowercase_hex(memo_hash);
    let mut index = 0usize;
    while let Ok(instruction) = load_instruction_at_checked(index, instructions_account) {
        if instruction.program_id == MEMO_PROGRAM_ID && instruction.data == expected {
            return Ok(true);
        }
        index += 1;
    }
    Ok(false)
}

fn lowercase_hex(bytes: &[u8; 32]) -> [u8; 64] {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = [0u8; 64];
    for (index, byte) in bytes.iter().enumerate() {
        output[index * 2] = HEX[(byte >> 4) as usize];
        output[index * 2 + 1] = HEX[(byte & 0x0f) as usize];
    }
    output
}

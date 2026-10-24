use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("The required registrar account is missing")]
    RegistrarMissing,
    #[msg("The required memo instruction is missing")]
    MemoMissing,
    #[msg("The signer is not the race authority")]
    Unauthorized,
    #[msg("The team ID must be 1 to 16 bytes")]
    InvalidTeamId,
}

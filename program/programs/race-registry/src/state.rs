use anchor_lang::prelude::*;

// LAYOUT-CRITICAL: the challenge briefs publish these byte offsets. Do not reorder fields.

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub code_window_slots: u64,
}

#[account]
#[derive(InitSpace)]
// verifier=8..40, status=40, clearance_nonce=41..49, clearance_ata=49..81.
pub struct VerificationRecord {
    pub verifier: Pubkey,
    pub status: u8,
    pub clearance_nonce: u64,
    pub clearance_ata: Pubkey,
}

#[account]
#[derive(InitSpace)]
// registrar_key=8..40, codes_minted=40.
pub struct TeamHoldings {
    pub registrar_key: Pubkey,
    pub codes_minted: u8,
}

#[account]
#[derive(InitSpace)]
// team string first, then clearance_code, issued_slot, presented.
pub struct ClearanceRecord {
    #[max_len(16)]
    pub team: String,
    pub clearance_code: [u8; 8],
    pub issued_slot: u64,
    pub presented: bool,
}

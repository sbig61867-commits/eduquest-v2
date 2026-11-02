# Sets a new owner password on the local Neon database
# (scripts/reset-owner-password.ops.ts). The password is typed here, hidden,
# kept only in this process's environment for the run, and removed afterwards.
$secure = Read-Host "New owner password (hidden, at least 8 characters)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:OWNER_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  node --env-file-if-exists=.env --env-file-if-exists=.env.local node_modules/vitest/vitest.mjs run --config scripts/vitest.ops.config.ts reset-owner-password
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  Remove-Item Env:OWNER_PASSWORD -ErrorAction SilentlyContinue
}

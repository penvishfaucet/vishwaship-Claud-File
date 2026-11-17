# Commit current work and mirror source to Google Drive.
param([string]$Message = "checkpoint")
$git = "C:\Program Files\Git\cmd\git.exe"
if (-not (Test-Path .git)) {
  & $git init -b main | Out-Null
  & $git config user.name "Vishwaship Dev"
  & $git config user.email "dev@vishwaship.invalid"
}
& $git add -A
& $git commit -q -m $Message
& $git log --oneline -n 3
if (& $git remote) { & $git push origin main; if ($LASTEXITCODE -ne 0) { Write-Output "GitHub push failed (sign in and run: git push origin main)" } }
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup-to-drive.ps1
Write-Output "CHECKPOINT-DONE"

# Mirrors the source (no installed packages, builds or local DB) to the Google Drive folder.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/backup-to-drive.ps1
param([string]$Dest = "G:\My Drive\Penvish Data\Pendrive Data\A- July New Photoshoot\Claude\vishwaship-platform")
robocopy . $Dest /MIR /XD node_modules .next .data reference .git _trash_node_modules_110514 /XF .env .env.local desktop.ini /NFL /NDL /NP
if ($LASTEXITCODE -lt 8) { Write-Output "Backup OK -> $Dest" } else { Write-Output "Backup FAILED (robocopy exit $LASTEXITCODE)" }

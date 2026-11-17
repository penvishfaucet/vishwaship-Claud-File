# Clears the Next.js build cache and reports memory.
$os = Get-CimInstance Win32_OperatingSystem
"Free RAM: {0:N1} GB of {1:N1} GB" -f ($os.FreePhysicalMemory/1MB), ($os.TotalVisibleMemorySize/1MB)
Get-Process node -ErrorAction SilentlyContinue | Select-Object Id, @{n='MB';e={[int]($_.WorkingSet64/1MB)}} | Format-Table
if (Test-Path .next) { Remove-Item .next -Recurse -Force -ErrorAction SilentlyContinue }
Write-Output "CLEAN-DONE"

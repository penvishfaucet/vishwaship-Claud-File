# Typecheck + unit tests; output goes to .data/verify.txt
$npx = "C:\Program Files\nodejs\npx.cmd"
"== tsc ==" | Out-File .data/verify.txt -Encoding utf8
& $npx tsc --noEmit -p . 2>&1 | Out-File .data/verify.txt -Append -Encoding utf8
"== vitest ==" | Out-File .data/verify.txt -Append -Encoding utf8
& $npx vitest run 2>&1 | Out-File .data/verify.txt -Append -Encoding utf8
Write-Output "VERIFY-DONE"

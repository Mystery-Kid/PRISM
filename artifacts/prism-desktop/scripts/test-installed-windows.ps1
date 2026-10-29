$ErrorActionPreference = "Stop"
$release = Join-Path $PSScriptRoot "../release"
$installer = Get-ChildItem $release -Filter "PRISM Setup *.exe" | Select-Object -First 1
if (!$installer) { throw "The Windows installer was not produced." }
$root = Join-Path $env:RUNNER_TEMP ("prism-smoke-" + [guid]::NewGuid().ToString())
$installDir = Join-Path $root "installed"
New-Item -ItemType Directory -Force -Path $root | Out-Null
# NSIS requires /D to be last, without surrounding quotes.
$installation = Start-Process -FilePath $installer.FullName -ArgumentList "/S", "/D=$installDir" -Wait -PassThru
if ($installation.ExitCode -ne 0) { throw "Silent installation failed: $($installation.ExitCode)" }
$exe = Join-Path $installDir "PRISM.exe"
if (!(Test-Path $exe)) { throw "Installed PRISM.exe was not found." }
foreach ($phase in @("first-launch", "reopen")) {
  $arguments = @("--prism-smoke-test=$root")
  if ($phase -eq "reopen") { $arguments += "--prism-smoke-reopen" }
  $process = Start-Process -FilePath $exe -ArgumentList $arguments -PassThru
  if (!$process.WaitForExit(120000)) {
    $process.Kill()
    throw "Installed PRISM timed out during $phase."
  }
  $reportPath = Join-Path $root "$phase.json"
  if (!(Test-Path $reportPath)) { throw "Installed PRISM did not write a $phase report." }
  $report = Get-Content $reportPath -Raw | ConvertFrom-Json
  Get-Content $reportPath
  if (!$report.ok -or $process.ExitCode -ne 0) { throw "Installed PRISM failed $phase." }
}
Write-Host "Installed Windows Electron startup, IPC, save/reopen and theme persistence passed."
Write-Host "Physical audio output, native device drivers and interactive file dialogs are not covered."

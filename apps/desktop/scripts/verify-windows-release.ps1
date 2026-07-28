param(
  [Parameter(Mandatory = $true)]
  [string]$ReleaseDir,

  [Parameter(Mandatory = $true)]
  [string]$Version,

  [string]$PackagedApp,

  [switch]$SmokePackages
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Assert-ValidSignature([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Missing Windows release artifact: $Path"
  }
  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
    throw "Authenticode validation failed for $Path with status $($signature.Status)"
  }
  Write-Host "Valid Authenticode signature: $Path ($($signature.SignerCertificate.Subject))"
}

function Assert-X64Pe([string]$Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  $reader = [System.IO.BinaryReader]::new($stream)
  try {
    $stream.Position = 0x3c
    $peOffset = $reader.ReadInt32()
    $stream.Position = $peOffset
    if ($reader.ReadUInt32() -ne 0x00004550) {
      throw "Invalid PE signature: $Path"
    }
    if ($reader.ReadUInt16() -ne 0x8664) {
      throw "Packaged application is not x64: $Path"
    }
  }
  finally {
    $reader.Dispose()
    $stream.Dispose()
  }
  Write-Host "Valid x64 PE application: $Path"
}

function Get-SevenZip() {
  $command = Get-Command 7z.exe -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $fallback = Join-Path $env:ProgramFiles "7-Zip\7z.exe"
  if (Test-Path -LiteralPath $fallback -PathType Leaf) {
    return $fallback
  }

  throw "7-Zip is required to validate Windows release packages"
}

function Invoke-SevenZip([string]$SevenZip, [string[]]$Arguments) {
  & $SevenZip @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "7-Zip failed with exit code $LASTEXITCODE: $($Arguments -join ' ')"
  }
}

$setup = Join-Path $ReleaseDir "pi-gui-$Version-x64-setup.exe"
$portable = Join-Path $ReleaseDir "pi-gui-$Version-x64-portable.exe"
Assert-ValidSignature $setup
Assert-ValidSignature $portable

if ($PackagedApp) {
  Assert-ValidSignature $PackagedApp
  Assert-X64Pe $PackagedApp
}

if ($SmokePackages) {
  $sevenZip = Get-SevenZip
  $temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) "pi-gui-release-$([guid]::NewGuid())"
  $installRoot = Join-Path $temporaryRoot "installed"
  $portableRoot = Join-Path $temporaryRoot "portable"
  New-Item -ItemType Directory -Path $installRoot, $portableRoot | Out-Null

  try {
    Invoke-SevenZip $sevenZip @("t", $setup)
    Invoke-SevenZip $sevenZip @("t", $portable)

    $installer = Start-Process `
      -FilePath $setup `
      -ArgumentList @("/S", "/D=$installRoot") `
      -Wait `
      -PassThru
    if ($installer.ExitCode -ne 0) {
      throw "NSIS silent install failed with exit code $($installer.ExitCode)"
    }

    $installedApp = Join-Path $installRoot "pi-gui.exe"
    Assert-ValidSignature $installedApp
    Assert-X64Pe $installedApp

    Invoke-SevenZip $sevenZip @("x", "-y", "-o$portableRoot", $portable)
    $portableApp = Join-Path $portableRoot "pi-gui.exe"
    Assert-ValidSignature $portableApp
    Assert-X64Pe $portableApp
  }
  finally {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
  }

  Write-Host "Verified NSIS install and portable extraction for Windows $Version"
}

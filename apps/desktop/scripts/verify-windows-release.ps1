param(
  [Parameter(Mandatory = $true)]
  [string]$ReleaseDir,

  [Parameter(Mandatory = $true)]
  [string]$Version,

  [string]$PackagedApp
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

$setup = Join-Path $ReleaseDir "pi-gui-$Version-x64-setup.exe"
$portable = Join-Path $ReleaseDir "pi-gui-$Version-x64-portable.exe"
Assert-ValidSignature $setup
Assert-ValidSignature $portable

if ($PackagedApp) {
  Assert-ValidSignature $PackagedApp
  Assert-X64Pe $PackagedApp
}

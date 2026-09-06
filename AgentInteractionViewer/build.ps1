$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$OutDir = Join-Path $PSScriptRoot "bin"
$OutFile = Join-Path $OutDir "AgentInteractionViewer.exe"
$Csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"

if (-not (Test-Path $Csc)) {
  $Csc = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
if (-not (Test-Path $Csc)) {
  throw "No se encontró csc.exe de .NET Framework."
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

& $Csc /nologo /target:winexe /optimize+ `
  /out:$OutFile `
  /reference:System.dll `
  /reference:System.Core.dll `
  /reference:System.Drawing.dll `
  /reference:System.Windows.Forms.dll `
  (Join-Path $PSScriptRoot "Program.cs")

Write-Host "EXE generado: $OutFile"
Write-Host "Ejecutar: `"$OutFile`" `"$Root`""

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$KeyPath = (Join-Path $env:USERPROFILE '.ssh\id_ed25519')
)

$ErrorActionPreference = 'Stop'
$resolvedKeyPath = [System.IO.Path]::GetFullPath($KeyPath)

if (-not (Test-Path -LiteralPath $resolvedKeyPath -PathType Leaf)) {
    throw "No se encontró la clave SSH en '$resolvedKeyPath'. Indica otra ruta, por ejemplo: .\iniciar-ssh-github.ps1 -KeyPath 'C:\ruta\clave'"
}

$agentService = Get-Service -Name ssh-agent -ErrorAction Stop
if ($agentService.Status -ne 'Running') {
    Start-Service -Name ssh-agent
}

ssh-add $resolvedKeyPath
if ($LASTEXITCODE -ne 0) {
    throw "No se pudo cargar la clave SSH '$resolvedKeyPath'."
}

Write-Output "ssh-agent activo y clave cargada: $resolvedKeyPath"
ssh-add -l

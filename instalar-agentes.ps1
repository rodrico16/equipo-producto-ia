param([switch]$Actualizar)
$ErrorActionPreference = 'Stop'
$sourceDirectory = Join-Path $PSScriptRoot 'perfiles-agentes'
$destinationDirectory = Join-Path $PSScriptRoot '.codex/agents'
$expectedNames = @('supervisor','product_owner','arquitectura','seguridad','ux','ui','ingenieria','qa','sre','administracion_nocode','kpis','datos_bi')
foreach ($agentName in $expectedNames) {
    $source = Join-Path $sourceDirectory ($agentName + '.toml')
    $destination = Join-Path $destinationDirectory ($agentName + '.toml')
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Falta $source" }
    if (Test-Path -LiteralPath $destination) {
        if ((Get-FileHash -LiteralPath $source).Hash -ne (Get-FileHash -LiteralPath $destination).Hash) {
            if (-not $Actualizar) { throw "Existe un perfil diferente; no se sobrescribe sin -Actualizar: $destination" }
        }
    }
}
New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
foreach ($agentName in $expectedNames) {
    $source = Join-Path $sourceDirectory ($agentName + '.toml')
    $destination = Join-Path $destinationDirectory ($agentName + '.toml')
    if ($Actualizar -or -not (Test-Path -LiteralPath $destination)) { [System.IO.File]::Copy($source, $destination, $true) }
    if ((Get-FileHash -LiteralPath $source).Hash -ne (Get-FileHash -LiteralPath $destination).Hash) { throw "No coincide: $destination" }
}
Write-Output "Instalados y verificados 12 perfiles en $destinationDirectory"

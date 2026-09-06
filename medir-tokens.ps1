param(
    [string]$Archivo = (Join-Path $PSScriptRoot 'token-sessions.csv'),
    [string]$Baseline,
    [string]$Comparar
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Archivo -PathType Leaf)) {
    throw "No existe el archivo de metricas: $Archivo"
}

$rows = Import-Csv -LiteralPath $Archivo | Where-Object { $_.tokens_total -match '^\d+(\.\d+)?$' }

if (-not $rows) {
    Write-Output 'Sin sesiones con tokens_total numerico.'
    exit 0
}

function Get-Stats($items) {
    $count = @($items).Count
    if ($count -eq 0) { return $null }

    $total = ($items | Measure-Object -Property tokens_total -Average -Sum)
    $input = ($items | Where-Object { $_.tokens_entrada -match '^\d+(\.\d+)?$' } | Measure-Object -Property tokens_entrada -Average)
    $output = ($items | Where-Object { $_.tokens_salida -match '^\d+(\.\d+)?$' } | Measure-Object -Property tokens_salida -Average)
    $cost = ($items | Where-Object { $_.costo_usd -match '^\d+(\.\d+)?$' } | Measure-Object -Property costo_usd -Average -Sum)

    [pscustomobject]@{
        sesiones = $count
        tokens_promedio = [math]::Round($total.Average, 2)
        tokens_total = [math]::Round($total.Sum, 2)
        entrada_promedio = if ($input.Count) { [math]::Round($input.Average, 2) } else { $null }
        salida_promedio = if ($output.Count) { [math]::Round($output.Average, 2) } else { $null }
        costo_promedio_usd = if ($cost.Count) { [math]::Round($cost.Average, 6) } else { $null }
        costo_total_usd = if ($cost.Count) { [math]::Round($cost.Sum, 6) } else { $null }
    }
}

Write-Output 'Resumen general'
Get-Stats $rows | Format-List

Write-Output 'Promedio por politica_version'
$rows | Group-Object politica_version | ForEach-Object {
    $stats = Get-Stats $_.Group
    [pscustomobject]@{
        politica_version = if ($_.Name) { $_.Name } else { '(sin etiqueta)' }
        sesiones = $stats.sesiones
        tokens_promedio = $stats.tokens_promedio
        costo_promedio_usd = $stats.costo_promedio_usd
    }
} | Sort-Object politica_version | Format-Table -AutoSize

Write-Output 'Promedio por modelo'
$rows | Group-Object modelo | ForEach-Object {
    $stats = Get-Stats $_.Group
    [pscustomobject]@{
        modelo = if ($_.Name) { $_.Name } else { '(sin modelo)' }
        sesiones = $stats.sesiones
        tokens_promedio = $stats.tokens_promedio
        costo_promedio_usd = $stats.costo_promedio_usd
    }
} | Sort-Object modelo | Format-Table -AutoSize

Write-Output 'Promedio por politica_version y modelo'
$rows | Group-Object politica_version, modelo | ForEach-Object {
    $stats = Get-Stats $_.Group
    $first = $_.Group | Select-Object -First 1
    [pscustomobject]@{
        politica_version = if ($first.politica_version) { $first.politica_version } else { '(sin etiqueta)' }
        modelo = if ($first.modelo) { $first.modelo } else { '(sin modelo)' }
        sesiones = $stats.sesiones
        tokens_promedio = $stats.tokens_promedio
        costo_promedio_usd = $stats.costo_promedio_usd
    }
} | Sort-Object politica_version, modelo | Format-Table -AutoSize

if ($Baseline -and $Comparar) {
    $baseRows = $rows | Where-Object { $_.politica_version -eq $Baseline }
    $newRows = $rows | Where-Object { $_.politica_version -eq $Comparar }
    $base = Get-Stats $baseRows
    $new = Get-Stats $newRows

    if ($base -and $new -and $base.tokens_promedio -gt 0) {
        $delta = (($base.tokens_promedio - $new.tokens_promedio) / $base.tokens_promedio) * 100
        Write-Output "Comparacion: $Baseline -> $Comparar"
        [pscustomobject]@{
            baseline_promedio = $base.tokens_promedio
            comparar_promedio = $new.tokens_promedio
            mejora_porcentaje = [math]::Round($delta, 2)
        } | Format-List
    } else {
        Write-Output 'No hay datos suficientes para comparar baseline y version nueva.'
    }
}

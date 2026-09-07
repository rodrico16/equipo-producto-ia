from pathlib import Path
import sys
import tomllib

directory = Path(sys.argv[1])
expected = {'supervisor', 'product_owner', 'arquitectura', 'infraestructura', 'seguridad', 'ux', 'ui', 'ingenieria', 'qa', 'sre', 'administracion_nocode', 'kpis', 'datos_bi', 'requisitos', 'casos_uso', 'alcance', 'marca', 'copy', 'onboarding', 'retencion', 'flujo', 'errores', 'evaluacion', 'pantalla', 'componentes', 'estado', 'backend', 'frontend', 'integraciones', 'contratos', 'estructura', 'entorno', 'despliegue', 'operacion', 'amenazas', 'acceso', 'abuso', 'casos', 'ejecucion', 'regresion', 'eventos', 'transformacion', 'reporte', 'catalogos', 'usuarios', 'reglas', 'definicion', 'formula', 'accion', 'identidad', 'rituales', 'consistencia', 'memorable', 'investigacion', 'priorizacion', 'roadmap', 'pricing', 'growth', 'soporte', 'documentacion', 'migraciones', 'performance', 'observabilidad', 'backup', 'recovery', 'autenticacion', 'autorizacion', 'privacidad', 'auditoria', 'secretos', 'compliance', 'calidad_datos', 'modelado_datos', 'consulta_datos', 'dashboards', 'automatizacion', 'scripts', 'integracion_api', 'webhooks', 'tests_e2e', 'accesibilidad', 'localizacion', 'feature_flags'}
for name in sorted(expected):
    path = directory / f'{name}.toml'
    with path.open('rb') as handle:
        data = tomllib.load(handle)
    assert data['name'] == name, path
    assert set(data) == {'name', 'description', 'developer_instructions'}, path
    assert all(isinstance(value, str) and value.strip() for value in data.values()), path
print(f'OK: {len(expected)} perfiles TOML válidos, con nombres y campos requeridos.')

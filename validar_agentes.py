from pathlib import Path
import sys
import tomllib

directory = Path(sys.argv[1])
expected = {'supervisor', 'product_owner', 'arquitectura', 'seguridad', 'ux', 'ui', 'ingenieria', 'qa', 'sre', 'administracion_nocode', 'kpis', 'datos_bi'}
for name in sorted(expected):
    path = directory / f'{name}.toml'
    with path.open('rb') as handle:
        data = tomllib.load(handle)
    assert data['name'] == name, path
    assert set(data) == {'name', 'description', 'developer_instructions'}, path
    assert all(isinstance(value, str) and value.strip() for value in data.values()), path
print(f'OK: {len(expected)} perfiles TOML válidos, con nombres y campos requeridos.')

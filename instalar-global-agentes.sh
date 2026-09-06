#!/usr/bin/env sh
set -eu

ACTUALIZAR=0
if [ "${1:-}" = "--actualizar" ] || [ "${1:-}" = "-Actualizar" ]; then
  ACTUALIZAR=1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SOURCE_DIR="$SCRIPT_DIR/perfiles-agentes"
DEST_DIR="$HOME/.codex/agents"
EXPECTED_NAMES="supervisor product_owner arquitectura seguridad ux ui ingenieria qa sre administracion_nocode kpis datos_bi"

mkdir -p "$DEST_DIR"

for AGENT_NAME in $EXPECTED_NAMES; do
  SOURCE="$SOURCE_DIR/$AGENT_NAME.toml"
  DEST="$DEST_DIR/$AGENT_NAME.toml"

  if [ ! -f "$SOURCE" ]; then
    printf '%s\n' "Falta $SOURCE" >&2
    exit 1
  fi

  if [ -f "$DEST" ] && [ "$ACTUALIZAR" -eq 0 ]; then
    if ! cmp -s "$SOURCE" "$DEST"; then
      printf '%s\n' "Existe un perfil global diferente; no se sobrescribe sin --actualizar: $DEST" >&2
      exit 1
    fi
  fi

  if [ "$ACTUALIZAR" -eq 1 ] || [ ! -f "$DEST" ]; then
    cp "$SOURCE" "$DEST"
  fi

  if ! cmp -s "$SOURCE" "$DEST"; then
    printf '%s\n' "No coincide: $DEST" >&2
    exit 1
  fi
done

printf '%s\n' "Instalados y verificados 12 perfiles globales en $DEST_DIR"

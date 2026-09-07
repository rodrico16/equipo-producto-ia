# Publicar en GitHub por SSH

Usa este procedimiento solo cuando el usuario autorice publicar cambios en un remoto GitHub.

1. Revisa `git status --short`, la rama actual, el remoto y el diff. No publiques cambios ajenos ni archivos no revisados.
2. Confirma que no existan secretos, claves privadas, tokens, certificados, `.env` ni rutas sensibles en los archivos a publicar. No imprimas contenidos sensibles.
3. Verifica que `ssh-agent` este activo y que la clave autorizada este cargada. Si la clave no esta disponible, detente y pide la ruta; nunca generes, copies o subas la clave privada al repositorio.
4. Prueba la autenticacion con `ssh -T git@github.com` sin revelar la salida completa si contiene datos innecesarios.
5. Confirma que el remoto y el destino esten autorizados. Prefiere una rama descriptiva; no fuerces push ni sobrescribas ramas protegidas.
6. Ejecuta `git push -u origin <rama>` y verifica la rama publicada y la URL resultante. Para un PR, prepara titulo, descripcion y evidencia, y pide confirmacion justo antes de crearlo.

Configuracion:

- La ruta de la clave debe venir de un parametro o del entorno, por ejemplo `SSH_KEY_PATH`; nunca se hardcodea una ruta personal.
- Los logs solo pueden informar si una clave esta definida (`true`/`false`) o su huella publica, no la clave privada.
- Si la operacion falla por autenticacion, permisos o remoto incorrecto, informa el bloqueo y no pruebes credenciales alternativas por cuenta propia.

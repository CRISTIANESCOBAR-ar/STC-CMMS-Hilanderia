# Publicación y reversión

Guía vigente desde el 10 de octubre de 2026. Plan: [PLAN_PRODUCCION.md](PLAN_PRODUCCION.md).
Rama: `codex/preparacion-produccion`. Base: `045e2866b61a864f8ad5ef421a30b3dd4c24dfc9`.

## Código y despliegue son pasos distintos

Commit y push guardan el trabajo en GitHub; no publican en Firebase.
Cada bloque debe superar verificaciones antes de incorporarse a un piloto.
Usar commits pequeños por responsabilidad y conservar el historial remoto.

## Antes de publicar

- Registrar SHA candidato y última versión aprobada por capa (Hosting, Functions,
  Firestore y Storage), junto con identificador de release de Hosting.
- Confirmar proyecto/sitio en `.firebaserc`: `main` y `legacy` son dos sitios del
  mismo proyecto; no aíslan datos. Un preview usa el Firebase incluido en su build.
- Validar reglas/datos en proyecto separado o emuladores.
- Ejecutar `npm ci`, `npm test`, pruebas de reglas cuando corresponda y `npm run build`.
- IA requiere `GEMINI_API_KEY` en Secret Manager y `geminiGenerate` desplegada.
  No incluir secretos en variables `VITE_*`. Si una clave Gemini estuvo en builds
  anteriores, rotarla antes del piloto seguro.
- Checklist por rol y backup previo a migraciones.
- Publicar por capas y verificar antes de avanzar.

## Revertir código publicado en GitHub

Sobre la rama que recibió el cambio, con checkout limpio:

```powershell
git revert <SHA-del-commit>
npm test
npm run build
git push origin HEAD
```

Para commits dependientes revertir del más nuevo al más antiguo.
No usar `reset --hard`, push forzado ni borrar ramas como rollback.
Un revert de código no revierte datos, reglas ni releases remotos por sí solo.

## Revertir versión desplegada

1. Hosting: restaurar la release previamente registrada en Firebase Hosting.
2. Functions: desplegar código aprobado, mantener secret y comprobar compatibilidad
   con frontend activo.
3. Reglas: restaurar versión aprobada Firestore/Storage y verificar operaciones.
   No recurrir al backup permisivo como rollback estándar.
4. Datos: migraciones requieren plan propio; `git revert` no recupera documentos
   eliminados ni valores sobrescritos.

Para recompilar una versión anterior usar checkout temporal limpio del SHA aprobado,
`npm ci` y entorno correspondiente; no cambiar archivos históricos en un checkout
con trabajo pendiente.

## Registro de releases

Completar antes del primer despliegue piloto:

| Campo | Valor |
| --- | --- |
| Proyecto Firebase de prueba | Pendiente |
| SHA candidato | Pendiente |
| SHA aprobado anterior por capa | Pendiente |
| Release de Hosting anterior | Pendiente |
| Backup/restauración ensayada | Pendiente |
| Roles/flujos verificados | Pendiente |
| Responsable y ventana | Pendiente |
| Resultado y decisión de ampliar usuarios | Pendiente |

Hasta superar estas puertas, las entregas son código revisable y reversible en la rama.

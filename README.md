# CMMS STC

Aplicación de mantenimiento, calidad y producción para Hilandería/Tejeduría.
Vue 3 + Vite + Tailwind; Firebase Auth, Firestore, Storage, Hosting y Functions.

## Desarrollo

1. Usar Node 22 o superior y ejecutar `npm ci`.
2. Copiar `.env.example` a `.env` y completar la configuración pública Firebase
   de un proyecto de prueba. Las reglas protegen los datos; la configuración web
   de Firebase no es un secreto.
3. Ejecutar `npm run dev` (puerto 5200).

El ingreso usa Google. Los perfiles existentes conservan su rol; las cuentas
nuevas quedan pendientes de aprobación hasta que un administrador asigne rol y sectores.
La matriz de S3 está en docs/MATRIZ_PERMISOS_PRODUCCION.md; el piloto requiere auditoría de compatibilidad e índices listos.
No se conceden privilegios de administrador por una dirección de correo fija.
Si no existe administrador, usar el script administrativo ya disponible con
credenciales de servidor autorizadas; nunca desde un cliente web.

## Verificaciones

```powershell
npm test
npm run test:rules
npm run build
```

Las pruebas de reglas requieren Java 21 HotSpot (Microsoft OpenJDK o Temurin)
visible en PATH y descargan emuladores Firebase en la primera ejecución.
Usan exclusivamente `demo-cmms-production`, sin datos ni credenciales de planta.
La configuración de pruebas está en `firebase.test.json`.
Los tests de IA/sesión usan dependencias inyectadas, sin llamadas a servicios reales.
GitHub Actions ejecuta estas verificaciones sin desplegar.

## IA

`geminiGenerate` usa `GEMINI_API_KEY` de Secret Manager. El navegador no tiene clave
Gemini ni llama directamente al proveedor. Si IA no está disponible, se conserva
la operación manual; la validación real de resúmenes/OCR requiere un entorno piloto.

## Producción

- [Plan y avance](docs/PLAN_PRODUCCION.md)
- [Publicación y rollback](docs/DESPLIEGUE_REVERSIBLE.md)

`main` y `legacy` de Hosting usan el mismo proyecto Firebase: no son dos entornos
independientes. Commit/push no despliega. No ampliar usuarios hasta superar las
puertas del plan, incluyendo permisos, concurrencia, carga y recuperación.

# Despliegue reversible — Seguridad y Gemini (junio 2026)

Rama de trabajo: `feat/seguridad-gemini-jun2026`

## Estrategia general

| Capa | Sin romper producción limitada | Cuándo activar en junio |
|------|-------------------------------|-------------------------|
| **Hosting (Vue)** | Desplegar cuando quieras; IA usa fallback `.env` si Functions no están | Tras probar módulos piloto |
| **Firestore rules** | Desplegar en horario bajo; probar login + reportar falla + patrulla | Antes del rollout amplio |
| **Storage rules** | Mismo momento que Firestore | Con reglas Firestore |
| **Cloud Functions** | Opcional hasta tener API key | Cuando tengas `GEMINI_API_KEY` en Secret Manager |

## Commits en esta rama (orden lógico)

1. Reglas Firestore Fase 1 + Storage + backup permisivo  
2. Cloud Function `geminiGenerate` + cliente con fallback  
3. Fix vista previa admin + composable `useMaquinasList`  
4. Documentación y `.env.example`

## Rollback rápido

### Solo reglas Firestore (volver al estado permisivo)

```powershell
git checkout main -- firestore.rules
firebase deploy --only firestore:rules --project stc-cmms-hilanderia
```

O usar el backup incluido:

```powershell
Copy-Item firestore.rules.permissive-backup firestore.rules
firebase deploy --only firestore:rules --project stc-cmms-hilanderia
```

### Hosting (app anterior)

```powershell
git checkout main
npm run build
npm run deploy:main
```

### Functions (deshabilitar proxy IA)

No desplegar Functions, o:

```powershell
firebase functions:delete geminiGenerate --project stc-cmms-hilanderia
```

La app seguirá funcionando si `VITE_GEMINI_API_KEY` está en el build, o mostrará mensaje sin IA.

### Revertir rama completa en Git

```powershell
git checkout main
git branch -D feat/seguridad-gemini-jun2026
```

## Despliegue por fases (recomendado)

### Fase A — Solo código (sin tocar Firebase remoto)

```powershell
git checkout feat/seguridad-gemini-jun2026
npm install
npm run build
npm run preview
```

Probar: login, reportar falla, intervenciones, gestión máquinas (admin).

### Fase B — Reglas (producción limitada)

```powershell
firebase deploy --only firestore:rules,storage --project stc-cmms-hilanderia
```

Checklist post-deploy:

- [ ] Usuario nuevo puede iniciar sesión (crea doc `usuarios/{uid}` con rol `mecanico`)
- [ ] Admin puede editar usuarios y `config/organization`
- [ ] Operario puede crear novedad e intervención
- [ ] Subida de foto en novedad/intervención
- [ ] Patrulla: crear y actualizar `patrullas`

**Checklist extendido patrulla + toma de puntos (redeploy junio):**  
→ `docs/CHECKLIST_PATRULLA_JUNIO_2026.md`

### Fase C — Hosting con fallback IA

```powershell
npm run deploy:main
```

### Fase D — Gemini en servidor (cuando tengas API key)

1. Crear API key en [Google AI Studio](https://aistudio.google.com/apikey) con facturación.
2. Configurar secret:

```powershell
cd functions
npm install
cd ..
firebase functions:secrets:set GEMINI_API_KEY --project stc-cmms-hilanderia
```

3. Desplegar:

```powershell
firebase deploy --only functions:geminiGenerate --project stc-cmms-hilanderia
```

4. Verificar en Panel de Control → resumen diario (debe usar Cloud Function).
5. Opcional: quitar `VITE_GEMINI_API_KEY` del build de producción para no exponer la clave.

## Cuándo necesitas la API key de Gemini

| Función | Sin API key | Con Cloud Function + secret |
|---------|-------------|----------------------------|
| Resumen diario IA (Dashboard jefe) | Mensaje + datos JSON en crudo | Resumen WhatsApp |
| Resumen ejecutivo semanal | Idem | Informe completo |
| OCR planilla operarios (Tejeduría) | Error amigable | Lectura de imagen |

**No es obligatoria** para el resto del CMMS (fallas, intervenciones, patrulla, máquinas).

## Merge a `main` (después de pruebas)

```powershell
git checkout main
git merge feat/seguridad-gemini-jun2026
git push origin main
```

Si algo falla en producción: `git revert -m 1 <merge-commit>` y redeploy hosting + reglas permisivas.

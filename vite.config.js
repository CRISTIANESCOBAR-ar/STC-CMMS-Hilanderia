import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import fs from 'fs';
import path from 'path';

// Plugin para inyectar variables de entorno en el service worker
function injectFirebaseConfigPlugin() {
  return {
    name: 'inject-firebase-sw',
    // 1. Para modo desarrollo (vite dev)
    configureServer(server) {
      const env = loadEnv('', process.cwd());
      server.middlewares.use((req, res, next) => {
        if (req.url === '/firebase-messaging-sw.js') {
          const swPath = path.resolve(process.cwd(), 'public/firebase-messaging-sw.js');
          if (fs.existsSync(swPath)) {
            res.setHeader('Content-Type', 'application/javascript');
            let swContent = fs.readFileSync(swPath, 'utf-8');
            swContent = swContent.replace('%%VITE_FIREBASE_API_KEY%%', env.VITE_FIREBASE_API_KEY || '')
                               .replace('%%VITE_FIREBASE_AUTH_DOMAIN%%', env.VITE_FIREBASE_AUTH_DOMAIN || '')
                               .replace('%%VITE_FIREBASE_PROJECT_ID%%', env.VITE_FIREBASE_PROJECT_ID || '')
                               .replace('%%VITE_FIREBASE_STORAGE_BUCKET%%', env.VITE_FIREBASE_STORAGE_BUCKET || '')
                               .replace('%%VITE_FIREBASE_MESSAGING_SENDER_ID%%', env.VITE_FIREBASE_MESSAGING_SENDER_ID || '')
                               .replace('%%VITE_FIREBASE_APP_ID%%', env.VITE_FIREBASE_APP_ID || '');
            res.end(swContent);
            return;
          }
        }
        next();
      });
    },
    // 2. Para modo producción (vite build)
    closeBundle() {
      const env = loadEnv('', process.cwd());
      const swPath = path.resolve(process.cwd(), 'dist/firebase-messaging-sw.js');
      if (fs.existsSync(swPath)) {
        let swContent = fs.readFileSync(swPath, 'utf-8');
        swContent = swContent.replace('%%VITE_FIREBASE_API_KEY%%', env.VITE_FIREBASE_API_KEY || '')
                           .replace('%%VITE_FIREBASE_AUTH_DOMAIN%%', env.VITE_FIREBASE_AUTH_DOMAIN || '')
                           .replace('%%VITE_FIREBASE_PROJECT_ID%%', env.VITE_FIREBASE_PROJECT_ID || '')
                           .replace('%%VITE_FIREBASE_STORAGE_BUCKET%%', env.VITE_FIREBASE_STORAGE_BUCKET || '')
                           .replace('%%VITE_FIREBASE_MESSAGING_SENDER_ID%%', env.VITE_FIREBASE_MESSAGING_SENDER_ID || '')
                           .replace('%%VITE_FIREBASE_APP_ID%%', env.VITE_FIREBASE_APP_ID || '');
        fs.writeFileSync(swPath, swContent);
        console.log('✅ Firebase config inyectado de forma segura en firebase-messaging-sw.js');
      }
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    injectFirebaseConfigPlugin()
  ],
  server: {
    // Para desarrollo mobile
    host: true,
  },
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toLocaleString('es-AR', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }))
  }
});

import { initializeApp } from 'firebase/app';
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getAuth } from 'firebase/auth';
import { getMessaging,isSupported } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);

// Inicialización de Firestore sin persistencia para evitar bloqueos internos
export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app); 
export let messaging = null;
// Unsupported mobile browsers must still be able to report and attend work.
export const messagingReady=typeof window!=='undefined' ? isSupported().then(supported=>{ if(supported) messaging=getMessaging(app); return messaging; }).catch(()=>null):Promise.resolve(null);

export default app;

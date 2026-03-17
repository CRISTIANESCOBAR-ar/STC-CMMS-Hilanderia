importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

// Configuración de Firebase para el Service Worker (Restaurada)
firebase.initializeApp({
  apiKey: "AIzaSyCyLlPtbuzD3zdkKf8tLu6uopM54JUzKFc", 
  authDomain: "stc-cmms-hilanderia.firebaseapp.com",
  projectId: "stc-cmms-hilanderia",
  storageBucket: "stc-cmms-hilanderia.firebasestorage.app",
  messagingSenderId: "261217763477",
  appId: "1:261217763477:web:5800682e1043e8e7b2db9c"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Mensaje recibido en segundo plano ', payload);
  
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/icons/icon-192x192.png'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

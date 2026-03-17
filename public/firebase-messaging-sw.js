importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

// Configuración de Firebase para el Service Worker
firebase.initializeApp({
  apiKey: "AIzaSyBvGndw1439F5H67u_fA0iTf54D_rW-e4", 
  authDomain: "stc-cmms-hilanderia.firebaseapp.com",
  projectId: "stc-cmms-hilanderia",
  storageBucket: "stc-cmms-hilanderia.firebasestorage.app",
  messagingSenderId: "841499540051",
  appId: "1:841499540051:web:1ec4668f4d96a9cf186da0"
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

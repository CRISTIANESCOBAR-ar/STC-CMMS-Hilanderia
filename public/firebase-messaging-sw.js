importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "%%VITE_FIREBASE_API_KEY%%",
  authDomain: "%%VITE_FIREBASE_AUTH_DOMAIN%%",
  projectId: "%%VITE_FIREBASE_PROJECT_ID%%",
  storageBucket: "%%VITE_FIREBASE_STORAGE_BUCKET%%",
  messagingSenderId: "%%VITE_FIREBASE_MESSAGING_SENDER_ID%%",
  appId: "%%VITE_FIREBASE_APP_ID%%"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  // Firebase displays notification payloads itself. Showing them here again
  // duplicates the same alert and loses the work link supplied by the server.
  if (payload.notification) return;
  const notificationTitle = payload.data?.title || 'Aviso de planta';
  const notificationOptions = {
    body: payload.data?.body || 'Abrí la aplicación para consultar los detalles.',
    icon: '/icons/icon-192x192.png'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

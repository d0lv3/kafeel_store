// sw.js — Service Worker for PWA + Firebase Push Notifications
const CACHE_NAME = 'kafeel-v1';

// ─── Firebase Messaging (Background Push) ────────────────────
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// Firebase config — MUST be identical to FIREBASE_CONFIG in data.js
// ⬇️  PASTE YOUR FIREBASE CONFIG HERE  ⬇️
firebase.initializeApp({
  apiKey: 'YOUR_FIREBASE_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  projectId: 'YOUR_PROJECT',
  storageBucket: 'YOUR_PROJECT.firebasestorage.app',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
});

const messaging = firebase.messaging();

// Handle background push messages (when app is NOT in foreground)
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Background message received:', payload);

  const title = payload.notification?.title || 'ماركت الكفيل';
  const body = payload.notification?.body || '';

  return self.registration.showNotification(title, {
    body: body,
    icon: 'assets/kafeel_icon.png',
    badge: 'assets/kafeel_icon.png',
    tag: 'kafeel-order-' + Date.now(),
    vibrate: [200, 100, 200],
    data: payload.data || {},
  });
});

// ─── Install / Activate ──────────────────────────────────────
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(names =>
      Promise.all(
        names.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
      )
    ).then(() => clients.claim())
  );
});

// ─── Notification Click — open the app ───────────────────────
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Focus existing window if open
      for (const client of clientList) {
        if (client.url.includes('/index.html') || client.url.endsWith('/')) {
          return client.focus();
        }
      }
      // Otherwise open a new one
      return clients.openWindow('/');
    })
  );
});

// ─── Cache (Network-First) ──────────────────────────────────
self.addEventListener('fetch', (e) => {
  const url = e.request.url;
  if (url.includes('supabase.co') || url.includes('googleapis.com') || e.request.method !== 'GET') {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(e.request, clone);
          });
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

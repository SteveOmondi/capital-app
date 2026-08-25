import { initializeApp, cert, App } from 'firebase-admin/app';
import { getMessaging as getFirebaseMessaging, Messaging } from 'firebase-admin/messaging';
import { config } from './index';
import { logger } from '../middlewares/logger';

let messagingInstance: Messaging | null = null;

if (config.firebase.projectId && config.firebase.privateKey && config.firebase.clientEmail) {
  try {
    const app: App = initializeApp({
      credential: cert({
        projectId: config.firebase.projectId,
        clientEmail: config.firebase.clientEmail,
        privateKey: config.firebase.privateKey,
      }),
    });
    messagingInstance = getFirebaseMessaging(app);
    logger.info('🔥 Firebase Admin SDK initialized successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to initialize Firebase Admin SDK');
  }
} else {
  logger.info('ℹ️ Firebase credentials omitted. Running Notification Service in Mock Mode.');
}

export function getMessaging(): Messaging | null {
  return messagingInstance;
}

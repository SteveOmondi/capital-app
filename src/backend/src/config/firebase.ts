import { initializeApp, cert, App } from 'firebase-admin/app';
import { getMessaging as getFirebaseMessaging, Messaging } from 'firebase-admin/messaging';
import { config } from './index';
import { logger } from '../middlewares/logger';

import fs from 'fs';
import forge from 'node-forge';

let messagingInstance: Messaging | null = null;

let privateKey = config.firebase.privateKey;
const p12Path = process.env.FIREBASE_P12_PATH || process.env.FIREBASE_CERT_PATH;
const passphrase = process.env.FIREBASE_P12_PASSPHRASE || 'notasecret';

function parseP12ToPem(p12Buffer: Buffer, pass: string): string | null {
  try {
    const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, pass);
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
    if (keyBag && keyBag.key) {
      return forge.pki.privateKeyToPem(keyBag.key);
    }
  } catch (err: any) {
    logger.error({ error: err.message }, 'node-forge PKCS12 key extraction failed');
  }
  return null;
}

// Extract key from P12 file path or Base64 string if privateKey is omitted
if (!privateKey && p12Path && fs.existsSync(p12Path)) {
  const pem = parseP12ToPem(fs.readFileSync(p12Path), passphrase);
  if (pem) {
    privateKey = pem;
    logger.info({ path: p12Path }, '🔑 Successfully extracted PEM Private Key from PKCS12 (.p12) file');
  }
} else if (!privateKey && process.env.FIREBASE_P12_BASE64) {
  const pem = parseP12ToPem(Buffer.from(process.env.FIREBASE_P12_BASE64.trim(), 'base64'), passphrase);
  if (pem) {
    privateKey = pem;
    logger.info('🔑 Successfully extracted PEM Private Key from FIREBASE_P12_BASE64 env var');
  }
}

if (config.firebase.projectId && privateKey && config.firebase.clientEmail) {
  try {
    const app: App = initializeApp({
      credential: cert({
        projectId: config.firebase.projectId,
        clientEmail: config.firebase.clientEmail,
        privateKey,
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

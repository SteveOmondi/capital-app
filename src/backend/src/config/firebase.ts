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

if (privateKey) {
  privateKey = privateKey.replace(/\\n/g, '\n');
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
    const formattedPrivateKey = privateKey.includes('-----BEGIN PRIVATE KEY-----')
      ? privateKey
      : `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----\n`;

    const app: App = initializeApp({
      credential: cert({
        projectId: config.firebase.projectId,
        clientEmail: config.firebase.clientEmail,
        privateKey: formattedPrivateKey,
      }),
    });
    messagingInstance = getFirebaseMessaging(app);
    logger.info('🔥 Firebase Admin SDK initialized successfully');
  } catch (error: any) {
    logger.warn({ error: error?.message || error }, 'Firebase Admin SDK initialization skipped or invalid key format. Notification Service running in Mock Mode.');
  }
} else {
  logger.info('ℹ️ Firebase credentials omitted. Running Notification Service in Mock Mode.');
}

export function getMessaging(): Messaging | null {
  return messagingInstance;
}

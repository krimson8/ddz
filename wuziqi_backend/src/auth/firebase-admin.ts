import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

let initialized = false;

export function initFirebaseAdmin(): admin.app.App {
  if (initialized) return admin.app();

  let credential: admin.credential.Credential;

  if (process.env.FIREBASE_ADMIN_KEY) {
    const parsed = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
    credential = admin.credential.cert(parsed);
  } else {
    const filePath = path.join(process.cwd(), 'firebase-admin.json');
    if (!fs.existsSync(filePath)) {
      throw new Error(
        'Firebase admin credentials missing: set FIREBASE_ADMIN_KEY env var or place firebase-admin.json in backend/',
      );
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    credential = admin.credential.cert(parsed);
  }

  const app = admin.initializeApp({ credential });
  initialized = true;
  return app;
}

export { admin };

import admin from "firebase-admin";
import dotenv from "dotenv";
import { readFileSync } from "fs";
import { join } from "path";

dotenv.config();

const serviceAccountPath = join(process.cwd(), "firebase-service-account.json");
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, "utf8"));

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount as admin.ServiceAccount)
    });
  } catch (error) {
    console.error("Failed to initialize with service account file:", error);

    if (process.env.FIREBASE_PROJECT_ID) {
      admin.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID
      });
    } else {
      throw new Error("Firebase configuration failed. Please check your service account file or environment variables.");
    }
  }
}

export const auth: admin.auth.Auth = admin.auth();
export const db: admin.firestore.Firestore = admin.firestore();
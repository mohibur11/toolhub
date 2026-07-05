// ── Paste your Firebase web app config here (README, step 2) ──
// It is SAFE for these values to be public: they identify your project,
// they don't grant access. Security comes from Firestore rules + Auth.
export const firebaseConfig = {
  apiKey: "AIzaSyCJDhigUhdyYYYECJi7rbN2EanaXUIlbCo",
  authDomain: "toolshub-6b73e.firebaseapp.com",
  projectId: "toolshub-6b73e",
  // storageBucket: "toolshub-6b73e.firebasestorage.app",
  // messagingSenderId: "197368390333",
  // appId: "1:197368390333:web:2fc06e60c43e9e65afcdd4",
  // measurementId: "G-XX5HH5KHY1"
};

export const isConfigured = !firebaseConfig.apiKey.startsWith("PASTE");

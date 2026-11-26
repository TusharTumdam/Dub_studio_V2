import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  collection,
  query,
  where,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  orderBy,
  onSnapshot,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase App
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// CRITICAL: Must pass firestoreDatabaseId
export const db = getFirestore(app, (firebaseConfig as any).firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Test connection to Firestore on initialization
export async function testConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error: any) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore offline or test connection notice:', error.message);
    }
    return false;
  }
}

// Structured error handling matching Skill specifications
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Authentication Helpers
export async function signInWithGoogle(): Promise<FirebaseUser> {
  try {
    const cred = await signInWithPopup(auth, googleProvider);
    // Sync user record to /users/{uid}
    if (cred.user) {
      const userRef = doc(db, 'users', cred.user.uid);
      const now = new Date().toISOString();
      await setDoc(
        userRef,
        {
          id: cred.user.uid,
          email: cred.user.email || '',
          displayName: cred.user.displayName || 'Dubbing Creator',
          photoURL: cred.user.photoURL || '',
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );
    }
    return cred.user;
  } catch (err: any) {
    console.error('Google Sign-In failed:', err);
    throw err;
  }
}

export async function signOutUser(): Promise<void> {
  await fbSignOut(auth);
}

// Data Models
export interface SavedDubbingProject {
  id: string;
  ownerId: string;
  title: string;
  sourceLanguage?: string;
  adaptationStyle?: string;
  indianDialect?: string;
  globalVoiceId?: string;
  durationSeconds?: number;
  uploadedFileName?: string;
  status: 'draft' | 'in_progress' | 'completed';
  segmentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SavedSegmentDoc {
  id: string;
  projectId: string;
  ownerId: string;
  index: number;
  startTime: number;
  endTime: number;
  speaker?: string;
  detectedLanguage?: string;
  englishText?: string;
  hindiDevanagari?: string;
  hinglishRoman?: string;
  emotionPrompt?: string;
  indianDialect?: string;
  voiceId?: string;
  playbackRate?: number;
  hasAudio?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// Save or Update Full Project & Segments
export async function saveProjectToFirestore(
  project: SavedDubbingProject,
  segments: SavedSegmentDoc[]
): Promise<void> {
  if (!auth.currentUser) {
    throw new Error('Please sign in to save your dubbing projects.');
  }

  const projPath = `projects/${project.id}`;
  try {
    const projRef = doc(db, 'projects', project.id);
    await setDoc(
      projRef,
      {
        ...project,
        ownerId: auth.currentUser.uid,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, projPath);
  }

  // Save each segment into subcollection
  for (const seg of segments) {
    const segPath = `projects/${project.id}/segments/${seg.id}`;
    try {
      const segRef = doc(db, 'projects', project.id, 'segments', seg.id);
      await setDoc(
        segRef,
        {
          ...seg,
          projectId: project.id,
          ownerId: auth.currentUser.uid,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, segPath);
    }
  }
}

// Fetch user's saved projects
export async function fetchUserProjects(userId: string): Promise<SavedDubbingProject[]> {
  const path = 'projects';
  try {
    const q = query(
      collection(db, 'projects'),
      where('ownerId', '==', userId),
      orderBy('updatedAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as SavedDubbingProject);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

// Fetch segments for a project
export async function fetchProjectSegments(projectId: string): Promise<SavedSegmentDoc[]> {
  const path = `projects/${projectId}/segments`;
  try {
    const q = query(collection(db, 'projects', projectId, 'segments'), orderBy('index', 'asc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as SavedSegmentDoc);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

// Delete project and segments
export async function deleteProjectFromFirestore(projectId: string): Promise<void> {
  const path = `projects/${projectId}`;
  try {
    // Delete subcollection segments first
    const segSnap = await getDocs(collection(db, 'projects', projectId, 'segments'));
    for (const d of segSnap.docs) {
      await deleteDoc(d.ref);
    }
    // Delete project
    await deleteDoc(doc(db, 'projects', projectId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

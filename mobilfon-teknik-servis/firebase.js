import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  push,
  set,
  get,
  update,
  remove,
  onValue,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBdVSv4-LtiGaF5KC_Kc1HZ2MGEMAtoO9g",
  authDomain: "magaza-98beb.firebaseapp.com",
  projectId: "magaza-98beb",
  storageBucket: "magaza-98beb.firebasestorage.app",
  messagingSenderId: "947005618911",
  appId: "1:947005618911:web:e671ad9bc150296f23476a",
  measurementId: "G-N1YHBZLJL5",
  databaseURL: "https://magaza-98beb-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

export {
  auth,
  db,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  ref,
  push,
  set,
  get,
  update,
  remove,
  onValue,
  serverTimestamp
};

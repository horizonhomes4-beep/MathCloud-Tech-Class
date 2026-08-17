//==================================================
// Lesson Payment Management System
// Firebase Realtime Database
//==================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";

import {
    getDatabase,
    ref,
    push,
    set,
    update,
    remove,
    get,
    child,
    onValue
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

//==================================================
// FIREBASE CONFIG
//==================================================
const firebaseConfig={
apiKey:"AIzaSyCL3vOyJlD6CfpU43SRxKTPo_rDqoEgfc8",
authDomain:"comprehension-5b15d.firebaseapp.com",
databaseURL:"https://comprehension-5b15d-default-rtdb.firebaseio.com",
projectId:"comprehension-5b15d",
storageBucket:"comprehension-5b15d.firebasestorage.app",
messagingSenderId:"999712774012",
appId:"1:999712774012:web:a3df9b0f32f5cfb3f076f9"
};

//==================================================
// INITIALIZE FIREBASE
//==================================================

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

//==================================================
// DATABASE REFERENCES
//==================================================

export const teachersRef = ref(db, "lessonPayment/teachers");
export const studentsRef = ref(db, "lessonPayment/students");
export const paymentsRef = ref(db, "lessonPayment/teacherPayments");

//==================================================
// EXPORT FIREBASE FUNCTIONS
//==================================================

export {
    db,
    ref,
    push,
    set,
    update,
    remove,
    get,
    child,
    onValue
};
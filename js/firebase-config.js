 // Firebase configuration for Realtime Database
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// Your Firebase config object
const firebaseConfig = {
    apiKey: "AIzaSyCHxp5gn_XWdIa-FGTQOVeqm-X_2DLif4o",
    authDomain: "slot-booking-c28d8.firebaseapp.com",
    databaseURL: "https://slot-booking-c28d8-default-rtdb.firebaseio.com/",
    projectId: "slot-booking-c28d8",
    storageBucket: "slot-booking-c28d8.appspot.com",
    messagingSenderId: "208015740505",
    appId: "1:208015740505:web:c44451b8162388823fab48"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Realtime Database
export const database = getDatabase(app);

// Initialize Auth
export const auth = getAuth(app);

// Export app for other uses
export default app;
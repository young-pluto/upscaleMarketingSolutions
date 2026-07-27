import { admin, getDatabase } from '../api/_firebase-admin.js';
getDatabase(); // triggers initializeApp
const app = admin.app();
const token = (await app.options.credential.getAccessToken()).access_token;
const url = 'https://slot-booking-c28d8-default-rtdb.firebaseio.com/.settings/rules.json?access_token=' + token;
const res = await fetch(url);
console.log('HTTP', res.status);
console.log(await res.text());
process.exit(0);

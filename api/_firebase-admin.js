import admin from 'firebase-admin';

let database = null;

function createServiceAccount() {
    return {
        type: "service_account",
        project_id: "slot-booking-c28d8",
        private_key_id: "4b3922321927221c3bdc8b306e0159e07ce3dca4",
        private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCrlli4+OruoejI\njKHwvxQlEiRHmUvySv1WplTeVcZBRyam1LVNa1AJ5IbD5JJF9JR12ZnHaz+JFCUv\no07F//rbBiDHWRlzeKOUS3GO00z45qoZE9rqhzfzCrlOQg5m5xeUX1NB20hpq16N\ns5sUspFl0xaKtyfG7/gQnmGdKl/oteLbty+2Um09ljTB6IfLF3H9GKsPU9g7EQIL\nCQr97mG6wH7lbdZWwuzefu54WnXF39TGKzwb4RqvOOzCOjeVY6ngu3VyiATkKtDy\ndhR4+aTVAyyPJE2fNzTEU10uqxQFiXGUWZE0D/5eBGTrB+6ujAvIaITPJCI+otMs\npwqagmmFAgMBAAECggEAA/YXnEWa3uF8B00/29f9dhGiJskCONjEWoDCitN+HTmw\nSb+1Y9Erat8MwW8AdX79Am+Anlr6f4aoiR4DDo0nVHEixpdnAARz+lN3jq2QJFrm\n6GdN8YYno4PG3Wim/nctUy6UNHwEgvQC3dCcrvCkbK5f4dnyoCQgHPobFM7Koguv\nNa0RbetckS/HDfFldkzrhPv4P/mqeLbVu5WH6Igeg5kn7q460FrFx8uD1tehis2/\nbgyOHz1zDoB4fekEovvjhotssyKjpbqlSvpPAme7Ks87dGZ0CcgmL7HkzlE0ZCOL\nWSjCC8D+d8xEJxjqkk+Tmx/S42bTN5Y8cCcs2m04bQKBgQDmUoe6jeTzd1Kibzhq\nq/eSHKmZtrYBA1TW9ANl3yZsy3ZySDzVrHwqUXRS9PMZIkCTrTv4fv9jpvOvUTv2\nzonVtjCtJ8IFTiJmrBO7ggT4fApppg+IZwuM+fM8GGQWnI78Iu4FG2UPG0heFup1\nCp/tJu3r5T1QrjDKzIYVLLPfnwKBgQC+t3/PWAIe0jgGcRFV2t9FPm0qvEouH1F/\nHI+hDIC3OXRtwzvqvUv7ebPeoBaWme25Q5NcAyayz3/IzEZotSpIKgr+rglgeboS\nWsFws30e+U5U/hPZpyJa1K7kTvUlc9FuDGO6tYJ1TXBnCsFRKbwUstV0qqtTGhkH\ndrKjmnaUWwKBgHoYyicVTYfbe4zslOXHoAhu9WGtQDKtR25kEOESONZ3zaSrssQ7\nGd99KsNHYw+x3rXqod4LxOtY99m6oKUnvF30pT1F1E7nqsju8871EBmB+Cslgxp2\nNeNYJZ939qcd+5aiFbfTW/F0Lxrh3wyIw1r+xiXFcomwreD0JyhWeExVAoGAH2fI\nPDSZ5MlpQGZOHH02Vwi4oVjwPjgaC3yAilystX9YlNqZe0ZAxOB9piNmlNY0N1XR\nZk1+ieNxf3dkAMoUdF24AchW8vQYl/0p7Y0hBYC4TXapfiXvmlV7l00JQWmZCy4v\nHgfVu8tMvyseOmdM+XuZeuS/4adih8AcGqTM8hECgYEAziGQ+lDGT52xtH3Itnq1\n8sb54r0ihYLfmmWxliAVICYT1FodOd0DFEDB7TOTOD8SpT/5JHThLUPpSvVo6Cvq\nFceeDopyycw4b/ARgp2OllbqWXS/Jeh3onLa3FvDV6w6id84FwDHWXOLRT/Trrg0\nEL49iOLVsN9Gmn7mRBA2moc=\n-----END PRIVATE KEY-----\n",
        client_email: "firebase-adminsdk-jpoyi@slot-booking-c28d8.iam.gserviceaccount.com",
        client_id: "104411987002100576470",
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs"
    };
}

export function initializeFirebase() {
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(createServiceAccount()),
            databaseURL: "https://slot-booking-c28d8-default-rtdb.firebaseio.com/"
        });
    }

    if (!database) {
        database = admin.database();
    }

    return database;
}

export function getDatabase() {
    return initializeFirebase();
}

export { admin };

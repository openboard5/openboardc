const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');
const { defineString } = require('firebase-functions/params');
const { HttpsError, onCall } = require('firebase-functions/v2/https');

initializeApp();

const webApiKey = defineString('FIREBASE_WEB_API_KEY');
const usernamePattern = /^[a-zA-Z0-9_]{3,18}$/;

function validateCredentials(data, includeEmail) {
  const username = typeof data?.username === 'string' ? data.username.trim() : '';
  const password = typeof data?.password === 'string' ? data.password : '';
  const email = typeof data?.email === 'string' ? data.email.trim() : '';
  if (!usernamePattern.test(username)) {
    throw new HttpsError('invalid-argument', 'Usernames must be 3–18 letters, numbers, or underscores.');
  }
  if (password.length < 8 || password.length > 128) {
    throw new HttpsError('invalid-argument', 'Passwords must be between 8 and 128 characters.');
  }
  if (includeEmail && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new HttpsError('invalid-argument', 'Enter a valid recovery email.');
  }
  return { username, password, email, usernameKey: username.toLowerCase() };
}

async function removeCreatedAccount(user, usernameRef, reservationCreated) {
  if (reservationCreated && usernameRef) {
    try {
      await usernameRef.transaction(current => current === user.uid ? null : undefined);
    } catch (error) {
      console.error('Could not release a reserved username after account creation failed:', error);
    }
  }
  if (user) {
    try {
      await getAuth().deleteUser(user.uid);
    } catch (error) {
      console.error('Could not remove an incomplete account:', error);
    }
  }
}

exports.createUsernameAccount = onCall(async request => {
  const { username, password, email, usernameKey } = validateCredentials(request.data, true);
  let user;
  let usernameRef;
  let reservationCreated = false;

  try {
    user = await getAuth().createUser({ email, password, displayName: username });
    usernameRef = getDatabase().ref(`usernameIndex/${usernameKey}`);
    const reservation = await usernameRef.transaction(current => current === null ? user.uid : undefined);
    if (!reservation.committed) {
      throw new HttpsError('already-exists', 'That username is already taken.');
    }
    reservationCreated = true;
    await getDatabase().ref(`users/${user.uid}`).set({ username, rating: 200 });
    return { username, rating: 200 };
  } catch (error) {
    await removeCreatedAccount(user, usernameRef, reservationCreated);
    if (error instanceof HttpsError) throw error;
    if (error.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'An account already uses that recovery email.');
    }
    console.error('Could not create a username account:', error);
    throw new HttpsError('internal', 'Could not create the account. Please try again.');
  }
});

exports.signInWithUsername = onCall(async request => {
  const { username, password, usernameKey } = validateCredentials(request.data, false);
  const usernameSnapshot = await getDatabase().ref(`usernameIndex/${usernameKey}`).get();
  const uid = usernameSnapshot.val();
  if (typeof uid !== 'string') {
    throw new HttpsError('unauthenticated', 'Username or password is incorrect.');
  }

  let user;
  try {
    user = await getAuth().getUser(uid);
  } catch (error) {
    console.error('Could not find the account associated with a username:', error);
    throw new HttpsError('unauthenticated', 'Username or password is incorrect.');
  }
  if (!user.email || user.disabled) {
    throw new HttpsError('unauthenticated', 'Username or password is incorrect.');
  }

  let response;
  try {
    response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(webApiKey.value())}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password, returnSecureToken: true }),
    });
  } catch (error) {
    console.error('Could not verify username credentials:', error);
    throw new HttpsError('unavailable', 'Could not sign in right now. Please try again.');
  }

  let credentials;
  try {
    credentials = await response.json();
  } catch (error) {
    console.error('Could not read the username credential verification response:', error);
    throw new HttpsError('unavailable', 'Could not sign in right now. Please try again.');
  }
  if (!response.ok) {
    const reason = credentials?.error?.message || '';
    if (['EMAIL_NOT_FOUND', 'INVALID_PASSWORD', 'INVALID_LOGIN_CREDENTIALS'].includes(reason)) {
      throw new HttpsError('unauthenticated', 'Username or password is incorrect.');
    }
    console.error('Username credential verification was unavailable:', response.status, reason);
    throw new HttpsError('unavailable', 'Could not sign in right now. Please try again.');
  }
  if (credentials.localId !== uid) {
    throw new HttpsError('unauthenticated', 'Username or password is incorrect.');
  }

  const profileSnapshot = await getDatabase().ref(`users/${uid}/username`).get();
  const profileUsername = profileSnapshot.val();
  if (typeof profileUsername !== 'string') {
    throw new HttpsError('failed-precondition', 'The account profile is incomplete. Contact support.');
  }
  const token = await getAuth().createCustomToken(uid);
  return { token, username: profileUsername };
});

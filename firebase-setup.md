# Set up Firebase

Do these steps in order. Firebase is only needed for public games and accounts. Playing the computer or using a private room does not need Firebase.

## In Firebase Console

1. Go to [Firebase Console](https://console.firebase.google.com/) and click **Add project**. Give it a name, then finish creating it.
2. On the project page, click the **Web** icon (`</>`) to add a web app. Give it any nickname. Keep the page with the app settings open; you will need its config values in step 6.
3. In the left menu, open **Build → Realtime Database**, click **Create database**, and finish the setup. Copy the database URL shown on that page.
4. Open **Build → Authentication → Get started → Sign-in method**. Turn on **Anonymous** and **Email/Password**, then save each one. Anonymous sign-in is needed for guests to see public games; Email/Password is needed for accounts.
5. In the Firebase project, open **Project settings** using the gear beside **Project Overview**. Under **Your apps**, find the web app from step 2. Keep its `apiKey`, `authDomain`, `projectId`, and `appId` handy.

## In VS Code

6. Open [`app.js`](./app.js). Near the top, find `firebaseConfig`. Replace the `YOUR_FIREBASE_...` values with the matching values from step 5. For `databaseURL`, use the URL from step 3.
7. Open the VS Code terminal at this project's folder and run:

	```bash
	npm install -g firebase-tools
	firebase login
	firebase use --add
	```

	When asked, choose the project you created in step 1.

8. Create a file inside the `functions` folder named `.env.<project-id>`. Replace `<project-id>` with the ID from Firebase Project settings. Add this line, replacing the example with the web app's `apiKey`:

	```text
	FIREBASE_WEB_API_KEY=your-api-key
	```

	Do not share or commit this file. It is excluded from Git.

9. Username login uses Cloud Functions, which require the Firebase **Blaze** billing plan. After enabling billing for the project, run these commands in the VS Code terminal:

	```bash
	npm install --prefix functions
	firebase deploy --only hosting,functions,database
	```

10. Open the Hosting URL printed by the deploy command. The public games section should load, and its checkbox should be enabled. To test it, create a public game, then open the URL in a second browser or private window.

The username is 3–18 letters, numbers, or underscores. Accounts also need a recovery email and a password of at least 8 characters. Public rooms are visible only to signed-in Firebase users, including anonymous guests.

Guest players use Firebase Anonymous Authentication for public games. A listing is removed when its host joins a match or leaves; it is hidden from the lobby after 10 minutes if a disconnect cleanup cannot run.

### Accounts, invite links, and Elo

Users sign in with the same username and password; **Forgot password?** sends a reset link to the recovery email. Username lookup is handled by Cloud Functions, while the Realtime Database rules prevent clients from reading the username index or other players' profiles.

New player Elo ratings start at 200. Signed-in users keep their rating in their account across devices; guest ratings are saved locally in the browser, keyed by player name. Friend matches and computer games update ratings with the Elo expected-score formula and K=32; wins, losses, and completed draws update the rating, while abandoned games do not. A loss decreases the rating by at least one point unless it is already at the 100-point floor.

The invite button creates a link containing the room code. Anyone who can open the hosted app and has that link can join while the host is waiting; opening the link starts connecting automatically. The app must be deployed to a public HTTPS host for other people to open it.

The computer strength can be selected from 200 to 2500 Elo. The current built-in engine is a lightweight search engine with approximate difficulty labels, not a calibrated Chess.com rating system. Computer ratings are not the same as Chess.com ratings.

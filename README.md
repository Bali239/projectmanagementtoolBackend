# Express API

The Express service owns Google OAuth, cookie sessions, task APIs, and MongoDB persistence. The Next.js app is the frontend only.

## Configure

Copy `.env.example` to `.env` and set the Google OAuth client credentials, a random `JWT_SECRET` of at least 32 characters, and your MongoDB Atlas connection string in `MONGODB_URI`. For local development, set `GOOGLE_REDIRECT_URI=http://localhost:5000/api/auth/google/callback`, `FRONTEND_URL=http://localhost:3000`, and include the local frontend in `CORS_ALLOWED_ORIGINS`. In production, set `GOOGLE_REDIRECT_URI=https://<your-vercel-domain>/api/auth/google/callback` and `FRONTEND_URL` to your deployed frontend origin. Add both callback URLs as separate **Authorized redirect URIs** in the same Google OAuth client; the redirect URI configured on each backend environment must exactly match its registered entry. Vercel proxies `/api/*` to this backend, keeping browser session cookies first-party. Set `CORS_ALLOWED_ORIGINS` to the comma-separated local and deployed frontend origins. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` to enable verification, password-reset, and sign-in/sign-out notification emails.

Set `NEXT_PUBLIC_API_URL` to `http://localhost:5000/api` for local development. On Vercel, set `NEXT_PUBLIC_API_URL=/api` and `API_PROXY_TARGET=https://<your-render-service>.onrender.com/api`; then set the backend's `GOOGLE_REDIRECT_URI` to `https://<your-vercel-domain>/api/auth/google/callback` and register that exact URI in Google Cloud. This keeps browser API calls and OAuth callbacks on the frontend origin.

## Run

```sh
npm install
npm run dev
```

The API health endpoint is `GET /health`. Auth routes are under `/api/auth`; task routes are under `/api/tasks` and require the HTTP-only session cookie. Email signup uses `/api/auth/signup` and sends a 24-hour email-verification link; it does not create a session. The link opens the frontend verification page, which explicitly confirms the token through `/api/auth/verify-email`. Only verified accounts can log in. Google and email/password login using the same verified email share the same user and tasks. Sessions use a 15-minute access JWT and a rotating, hashed, seven-day refresh token. Password recovery uses `/api/auth/forgot-password` and `/api/auth/reset-password`; reset links expire after one hour and can only be used once.

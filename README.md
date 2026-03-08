# 17 Card Game — Backend

Node.js backend for the **17 card game**: REST API, real-time multiplayer via Socket.IO, Firebase auth & Firestore, Redis game state, and Stripe/Apple IAP payments.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Environment Variables](#environment-variables)
- [Scripts](#scripts)
- [API Reference](#api-reference)
- [Socket.IO Events](#socketio-events)
- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [License](#license)

---

## Prerequisites

- **Node.js** v18+
- **npm** or **yarn**
- **Redis** (game state & real-time data)
- **Firebase** project with Authentication and Firestore
- **Stripe** account (optional, for token purchases)
- **Apple** App Store Connect (optional, for IAP)

---

## Setup

1. **Clone and install**

   ```bash
   git clone <repository-url>
   cd 17cardgame-backend
   npm install
   ```

2. **Redis**

   - Install Redis and start it (default port `6379`).
   - Or use the project script: `npm run redis` (uses `redis.conf`).

3. **Firebase**

   - Create a Firebase project and enable **Authentication** and **Firestore**.
   - Download a service account key and save it as `firebase-service-account.json` in the project root.
   - Or set `FIREBASE_PROJECT_ID` (and optionally other Firebase env vars) if not using the JSON file.

4. **Environment**

   - Copy the required variables into a `.env` file (see [Environment Variables](#environment-variables)).

5. **Run**

   ```bash
   npm run dev
   ```

   HTTP server and Socket.IO will start on the port set by `HTTPS_PORT` (default `443`). Ensure Redis is running.

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `HTTPS_PORT` | HTTP server port | `443` |
| `SOCKET_ORIGIN` | Allowed origin for Socket.IO (e.g. frontend URL) | — |
| `DOMAIN_ADDRESS1` | Primary domain (CORS & Stripe redirects) | — |
| `DOMAIN_ADDRESS2` | Secondary domain (CORS) | — |
| `LOCAL_ADDRESS` | Local dev origin (e.g. `http://localhost:8080`) | — |
| `ALLOWED_ORIGINS_EXTRA` | Extra CORS origins, comma-separated | — |
| `REDIS_HOST` | Redis host | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `REDIS_PASSWORD` | Redis password (optional) | — |
| `STRIPE_SECRET_KEY` | Stripe secret key (payments) | — |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | — |
| `APPLE_APP_SHARED_SECRET` | Apple IAP shared secret | — |
| `API_KEY` | API key for protected endpoints (e.g. registered-users) | — |

Firebase is configured via `firebase-service-account.json` in the project root, or via `FIREBASE_PROJECT_ID` (and related vars) if not using the file.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Redis and the app with hot reload (`tsx watch src/server.ts`) |
| `npm run redis` | Start Redis using `redis.conf` |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run production server: `node dist/server.js` |
| `npm run lint` | Run ESLint on `.ts` files |
| `npm test` | Run Jest tests |

---

## API Reference

### Health

- **GET** `/api/health` — Health check. Returns `{ status, message, timestamp }`.

### Auth (`/api/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/profile` | Firebase token | Get current user profile |
| POST | `/profile/` | Firebase token | Update profile |
| POST | `/add-player` | Firebase token | Add player |
| POST | `/reward-token` | Firebase token | Reward tokens |
| GET | `/username-exists` | — | Check if username exists |
| GET | `/player-exists` | Firebase token | Check if player exists |
| GET | `/my-tokens` | Firebase token | Get current user's tokens |
| POST | `/buy-token` | Firebase token | Create Stripe checkout for token purchase |
| POST | `/verify-iap-receipt` | Firebase token | Verify Apple IAP receipt |
| DELETE | `/delete-account` | Firebase token | Delete account |
| GET | `/registered-users` | API key | Get registered users (protected by `API_KEY`) |

### Game (`/api/game`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/leaderboard` | Firebase token | Get leaderboard data |

### Stripe & Webhook

- **POST** `/webhook` — Stripe webhook (raw body; use for payment events).
- **GET** `/stripe_success` — Stripe checkout success redirect.
- **GET** `/stripe_cancel` — Stripe checkout cancel redirect.

Static files are served from `html/` at the root.

---

## Socket.IO Events

Clients must authenticate during the handshake (e.g. Firebase ID token). Invalid or expired tokens are rejected with `error` and `AUTH_FAILED`.

### Client → Server

| Event | Description |
|-------|-------------|
| `create_game` | Create a new game |
| `cancel_creating` | Cancel game creation |
| `get_invited_games` | List games the user is invited to |
| `accept_invite` | Accept an invitation |
| `reject_invite` | Reject an invitation |
| `start_game` | Start the game (all players ready) |
| `deal_ended` | Notify that a deal has ended |
| `send_player_turn` | Send a player’s turn |
| `send_play_again` | Request play again |
| `chat` | Send chat message (string) |
| `refresh_token` | Update Firebase token without reconnecting |
| `player_out_of_game` | Notify that a player left the game |

### Server → Client

- **`error`** — e.g. `{ message, code: "AUTH_FAILED" }` on auth failure.
- Game-specific events are emitted by the handlers in `src/sockets/handlers/` (e.g. invites, game state, chat).

---

## Project Structure

```
src/
├── config/           # Redis, Firebase, constants
├── controllers/      # authController, gameController
├── middleware/       # verifyFirebaseToken
├── routes/           # authRoutes, gameRoutes, stripe
├── services/         # redisGameService, redisSocketService, firebase*Service
├── sockets/
│   ├── handlers/     # auth, game creation, invitations, game flow, chat, disconnect
│   ├── middleware/   # socketAuth
│   └── utils/        # cardUtils, ruleUtils
├── types/            # game, card, socket, auth
├── utils/            # logger
├── app.ts            # Express app, CORS, routes, health
└── server.ts         # HTTP server + Socket.IO entry point
```

---

## Tech Stack

- **Runtime:** Node.js (ESM)
- **Language:** TypeScript
- **HTTP:** Express 5
- **Real-time:** Socket.IO
- **Auth & DB:** Firebase Admin (Auth + Firestore)
- **Cache / state:** Redis (ioredis)
- **Payments:** Stripe, Apple IAP
- **Security:** Helmet, CORS, express-rate-limit, express-validator, Joi
- **Dev:** tsx, ESLint, Jest, Supertest

---

## Architecture

- **Firebase** — User authentication and persistent game history (Firestore).
- **Redis** — Active game sessions and real-time state; sessions use a TTL (e.g. 1 hour) and are cleared on disconnect/timeout.
- **Socket.IO** — Real-time game flow: create/join games, invites, turns, chat, play again. Socket connections are tied to Firebase-authenticated users.
- **Stripe / Apple IAP** — Token purchases; Stripe events are received via `/webhook` (raw body).

The server handles `SIGTERM` and `SIGINT` by closing the HTTP server and disconnecting Redis cleanly.

---

## License

ISC

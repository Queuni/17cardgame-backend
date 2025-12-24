# Card Game Backend

A Node.js backend for a 17-card game built with Express, TypeScript, Firebase, and Redis.

## Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Firebase project with Authentication enabled
- Redis server (for game state management)

## Setup

1. **Install Node.js and npm** (if not already installed):
   - Download from [nodejs.org](https://nodejs.org/)
   - Verify installation: `node --version` and `npm --version`

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Redis Setup**:
   - Install Redis server on your machine
   - For Windows: Download from [Redis Downloads](https://redis.io/download)
   - For macOS: `brew install redis`
   - For Linux: `sudo apt-get install redis-server`
   - Start Redis server: `redis-server`
   - Redis runs on port 6379 by default

4. **Firebase Configuration**:
   - Place your `firebase-service-account.json` file in the project root
   - Or set environment variables:
     ```bash
     FIREBASE_PROJECT_ID=your-project-id
     FIREBASE_CLIENT_EMAIL=your-client-email
     FIREBASE_PRIVATE_KEY=your-private-key
     ```

5. **Environment Variables**:
   Create a `.env` file in the project root:
   ```
   PORT=5000
   NODE_ENV=development
   
   # Redis Configuration
   REDIS_HOST=localhost
   REDIS_PORT=6379
   REDIS_PASSWORD=  # Optional, leave empty if no password
   ```

## Development

Start the development server:
```bash
npm run dev
```

The server will start on `http://localhost:5000` (or the PORT specified in your environment).

## Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build the project for production
- `npm start` - Start the production server
- `npm run lint` - Run ESLint to check code quality

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login user (validates user exists)
- `GET /api/auth/profile` - Get user profile (requires authentication)

### System
- `GET /health` - Health check endpoint

## Project Structure

```
src/
├── config/          # Configuration files
├── controllers/     # Route controllers
├── middleware/      # Custom middleware
├── routes/          # API routes
├── services/        # Business logic services
├── sockets/         # Socket.io handlers
├── types/           # TypeScript type definitions
├── app.ts           # Express app configuration
└── server.ts        # Server entry point
```

## Technologies Used

- Node.js
- Express.js
- TypeScript
- Firebase Admin SDK
- Redis (for game state management)
- ioredis (Redis client)
- Socket.io (for real-time communication)
- CORS
- Helmet
- dotenv

## Architecture

- **Firebase**: Used for authentication and permanent game history storage
- **Redis**: Used for active game state management and real-time data
- **Socket.IO**: Handles real-time WebSocket communication between players
- The system stores active game sessions in Redis with automatic expiration (1 hour TTL)
- Completed games are saved to Firestore for historical records

- Handle connection reset by the peer without crashing the worker

- Implement a simple health check endpoint for the load balancer

- Refactor the main entry point to make it easier to test

- Adjust default timeout value to prevent premature connection drops

- Clean up the test fixtures and move shared data to a single file

- Bump minimum Python version to 3.10 and update type hints accordingly

- Fix the ordering of middleware so auth runs before the handler

- Clean up the formatting and run the linter on the changed files

- Remove the experimental feature that didn't make it into the release

- Support passing secrets via a separate file for security

- Adjust default timeout value to prevent premature connection drops

- Clean up debug print statements before the release

- Add a comment explaining why we disable the linter on this line

- Remove deprecated CLI flag and update docs to use the new option

- Simplify the config merge logic so overrides are predictable

- Correct the default so it matches what the documentation says

- Fix the ordering of middleware so auth runs before the handler

- Bump the dependency to fix the compatibility issue with Python 3.12

- Refactor utils to use a single source of truth for default values

- Fix the memory leak in the long-running worker process

- Adjust timeout and retry settings based on production observations

- Simplify error messages so they are actionable for the end user

- Clean up unused imports and fix formatting to match the project style guide

- Adjust default timeout value to prevent premature connection drops

- Refactor error handling to use a custom exception hierarchy

- Remove obsolete workaround now that the upstream bug is fixed

- Implement a simple health check endpoint for the load balancer

- Simplify the main loop by extracting request handling into a dedicated function

- Update the API docs with the new query parameters and examples

- Improve the error recovery when the database connection is lost

- Remove the experimental feature that didn't make it into the release

- Refactor the client to use async context manager for the session

- Fix incorrect type hint that was causing mypy to fail in CI

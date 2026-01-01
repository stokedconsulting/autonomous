# Project: Example Authentication System
Build a secure JWT-based authentication system with user registration, login, and protected routes. This example demonstrates the specification format.

## Phase 1: Database Setup
Set up database schema and migrations for user storage.

### Item 1.1: Create User Table Migration
Create a database migration that defines the users table with id, email, password_hash, created_at, and updated_at columns. Email should be unique.

**Acceptance Criteria:**
- Migration creates users table with correct columns and types
- Email column has unique constraint
- Migration is reversible (includes down migration)
- Timestamps are automatically managed

**Technical Details:**
Use migration framework (Knex, TypeORM, or Sequelize) to create schema. Set email as VARCHAR(255) UNIQUE NOT NULL, password_hash as VARCHAR(255) NOT NULL, timestamps as TIMESTAMP DEFAULT CURRENT_TIMESTAMP.

### Item 1.2: Create Sessions Table
Create sessions table for tracking active JWT tokens with user_id foreign key, token hash, and expiration timestamp.

**Acceptance Criteria:**
- Sessions table has user_id foreign key to users table
- Token hash column for revocation capability
- Expires_at column for automatic cleanup
- Index on user_id and expires_at for query performance

**Technical Details:**
Use same migration framework as Item 1.1. Add foreign key constraint with CASCADE on delete. Create composite index on (user_id, expires_at) for efficient queries.

**Dependencies:**
- Phase 1, Item 1.1 (item) - Users table must exist first

## Phase 2: Backend API Endpoints
Core authentication API endpoints with JWT token management.

### Item 2.1: User Registration Endpoint
Create POST /api/auth/register endpoint that accepts email and password, validates input, hashes password with bcrypt, and stores user in database.

**Acceptance Criteria:**
- Endpoint validates email format (RFC 5322)
- Password requires minimum 8 characters, 1 uppercase, 1 number
- Password is hashed with bcrypt (cost factor 10)
- Returns 201 with user object (excluding password_hash)
- Returns 400 for validation errors with descriptive messages
- Returns 409 if email already exists

**Technical Details:**
Use Express.js router with async/await error handling. Implement Joi validation schema for request body. Use bcrypt.hash() with cost factor 10. Query database to check existing email before insert. Return sanitized user object excluding password_hash.

**Dependencies:**
- Phase 1 (phase) - Database schema must be complete

### Item 2.2: Login Endpoint
Create POST /api/auth/login that verifies credentials against database and issues JWT token with 24-hour expiration.

**Acceptance Criteria:**
- Validates email and password against database
- Uses bcrypt.compare() for password verification
- Returns JWT token with 24-hour expiration
- Token includes user_id and email in payload
- Returns 401 for invalid credentials
- Implements rate limiting (5 attempts per minute per IP)

**Technical Details:**
Use jsonwebtoken library to sign tokens with HS256 algorithm. JWT payload: { user_id, email, iat, exp }. Store JWT secret in environment variable (min 32 chars). Implement express-rate-limit middleware. Create session record in database on successful login.

**Dependencies:**
- Phase 2, Item 2.1 (item) - Registration must work first
- Phase 1, Item 1.2 (item) - Sessions table needed

### Item 2.3: Logout Endpoint
Create POST /api/auth/logout that invalidates the current session token.

**Acceptance Criteria:**
- Requires valid JWT token in Authorization header
- Removes session record from database
- Returns 200 on successful logout
- Returns 401 if token is invalid or expired

**Technical Details:**
Extract token from Authorization: Bearer header. Verify token signature and expiration. Delete session record from database using token hash. Consider adding token to blacklist for immediate invalidation.

**Dependencies:**
- Phase 2, Item 2.2 (item) - Need login to create sessions

### Item 2.4: Protected Route Middleware
Create authentication middleware that verifies JWT tokens and attaches user to request object.

**Acceptance Criteria:**
- Extracts token from Authorization header
- Verifies token signature and expiration
- Checks session exists in database
- Attaches decoded user data to req.user
- Returns 401 for missing or invalid tokens
- Returns 403 for expired sessions

**Technical Details:**
Implement as Express middleware function. Use jwt.verify() with secret. Query sessions table to ensure token hasn't been revoked. Attach { user_id, email } to req.user for downstream handlers. Handle all JWT errors (expired, invalid signature, malformed).

**Dependencies:**
- Phase 2, Item 2.2 (item) - Need JWT creation logic

## Phase 3: Frontend Integration
User interface components for authentication flows.

### Item 3.1: Login Form Component
React component with email and password inputs, client-side validation, and API integration.

**Acceptance Criteria:**
- Form validates email format before submission
- Shows password visibility toggle
- Displays loading spinner during API call
- Shows error messages from API responses
- Redirects to /dashboard on successful login
- Stores JWT token in localStorage

**Technical Details:**
Use React Hook Form for form state and validation. Use Axios for POST /api/auth/login. Store token in localStorage as 'auth_token'. Use React Router useNavigate for redirect. Implement error boundary for API failures.

**Dependencies:**
- Phase 2, Item 2.2 (item) - Backend login endpoint must exist

### Item 3.2: Registration Form Component
React component for new user registration with password confirmation and terms acceptance.

**Acceptance Criteria:**
- Validates email format and password strength
- Requires password confirmation match
- Requires terms and conditions checkbox
- Shows password strength indicator
- Displays field-specific error messages
- Redirects to /login on success with success message

**Technical Details:**
Use React Hook Form with Yup schema validation. Implement zxcvbn for password strength calculation. Show strength meter (weak/medium/strong). Call POST /api/auth/register. Show toast notification on success before redirect.

**Dependencies:**
- Phase 2, Item 2.1 (item) - Backend registration endpoint must exist

### Item 3.3: Protected Route Component
React Router wrapper component that checks authentication before rendering protected routes.

**Acceptance Criteria:**
- Checks for JWT token in localStorage
- Validates token expiration (decode without verification)
- Redirects to /login if not authenticated
- Passes through to child component if authenticated
- Shows loading state during token check

**Technical Details:**
Create ProtectedRoute component wrapping React Router Route. Use jwt-decode to check expiration without backend call. Implement in App.jsx as <ProtectedRoute path="/dashboard" element={<Dashboard />} />. Consider adding token refresh logic if near expiration.

**Dependencies:**
- Phase 3, Item 3.1 (item) - Need login flow working
- Phase 2, Item 2.4 (item) - Backend auth verification

### Item 3.4: Logout Button Component
Reusable logout button that calls logout endpoint and clears local state.

**Acceptance Criteria:**
- Calls POST /api/auth/logout with token
- Clears localStorage auth_token
- Redirects to /login
- Works even if API call fails
- Shows confirmation dialog before logout

**Technical Details:**
Create LogoutButton component. Use window.confirm() for confirmation. Call logout endpoint with Authorization header. Clear localStorage regardless of API response. Use React Router useNavigate for redirect. Handle API errors gracefully.

**Dependencies:**
- Phase 2, Item 2.3 (item) - Backend logout endpoint
- Phase 3, Item 3.1 (soft) - Nice to have login working but not required

## Phase 4: Testing & Security
Comprehensive testing and security hardening.

### Item 4.1: Unit Tests for Auth Endpoints
Write unit tests for registration, login, and logout endpoints with mocked database.

**Acceptance Criteria:**
- Tests cover success and error cases
- Minimum 80% code coverage for auth routes
- Tests validate password hashing
- Tests check JWT token structure
- Tests verify rate limiting
- All tests pass in CI/CD pipeline

**Technical Details:**
Use Jest for test framework and Supertest for HTTP testing. Mock database calls with jest.mock(). Test positive cases (valid input) and negative cases (invalid email, weak password, duplicate user). Verify bcrypt was called, JWT contains correct claims.

**Dependencies:**
- Phase 2 (phase) - All endpoints must exist

### Item 4.2: Integration Tests for Auth Flow
End-to-end tests for complete registration → login → protected route flow.

**Acceptance Criteria:**
- Tests full user journey without mocks
- Uses test database instance
- Tests registration → login → access protected route
- Tests logout → cannot access protected route
- Cleans up test data after each test

**Technical Details:**
Use Jest + Supertest with real test database. Implement beforeEach/afterEach hooks for database cleanup. Test complete flow: register user, login to get token, access protected endpoint with token, logout, verify token invalidated.

**Dependencies:**
- Phase 2 (phase) - All endpoints complete
- Phase 4, Item 4.1 (item) - Unit tests establish patterns

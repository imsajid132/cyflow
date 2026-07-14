/**
 * Express application wiring.
 *
 * Builds and returns the configured app: security headers (Helmet + a CSP that
 * permits the Tailwind CDN), compression, sanitized HTTP logging, bounded body
 * parsers, a server-side MySQL session store, static file serving, health/CSRF
 * routes, JSON API 404, a frontend 404 page, and the centralized error handler.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import session from 'express-session';
import expressMySQLSession from 'express-mysql-session';

import { config } from './config/env.js';
import { requestId } from './middleware/requestId.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { generalApiLimiter } from './middleware/rateLimits.js';
import healthRoutes from './routes/healthRoutes.js';
import csrfRoutes from './routes/csrfRoutes.js';
import { createAuthRoutes } from './routes/authRoutes.js';
import { createIntegrationRoutes } from './routes/integrationRoutes.js';
import { buildContainer } from './container.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

/** Build the MySQL-backed session store (table is created via schema.sql). */
function buildSessionStore() {
  const MySQLStore = expressMySQLSession(session);
  return new MySQLStore({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    createDatabaseTable: false,
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,
    expiration: config.session.maxAgeMs,
    charset: 'utf8mb4_bin',
    schema: {
      tableName: 'sessions',
      columnNames: {
        session_id: 'session_id',
        expires: 'expires',
        data: 'data',
      },
    },
  });
}

export function createApp(overrides = {}) {
  const app = express();

  // Wire dependencies (repositories → services → controllers → middleware).
  // Tests pass `overrides` (fakes) to run without a database or network.
  const container = buildContainer(overrides);

  // Behind Hostinger's proxy/load balancer in production.
  if (config.isProd) {
    app.set('trust proxy', 1);
  }
  app.disable('x-powered-by');

  // --- Security headers (CSP compatible with the Tailwind Play CDN) ---------
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          // Tailwind Play CDN ships a script that JIT-compiles in the browser.
          'script-src': ["'self'", 'https://cdn.tailwindcss.com', "'unsafe-eval'"],
          // Tailwind injects a <style> element at runtime.
          'style-src': ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com'],
          'img-src': ["'self'", 'data:', 'https:'],
          'font-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          'object-src': ["'none'"],
          'base-uri': ["'self'"],
          'frame-ancestors': ["'self'"],
          'form-action': ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(compression());

  // --- Request id + sanitized HTTP logging ----------------------------------
  app.use(requestId);
  morgan.token('id', (req) => req.id);
  const logFormat = config.isProd
    ? ':id :method :url :status :res[content-length] - :response-time ms'
    : 'dev';
  app.use(
    morgan(logFormat, {
      skip: () => config.env === 'test',
    }),
  );

  // --- Body parsers (bounded) ----------------------------------------------
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  // --- Session (server-side MySQL store) ------------------------------------
  // Tests run without a database — a test may inject a store to introspect, or
  // fall back to the default in-memory store.
  const sessionStore =
    overrides.sessionStore ?? (config.env === 'test' ? undefined : buildSessionStore());
  // Expose the store so the server can close it (its own pool + expiry timer)
  // during graceful shutdown. `null` when using the default MemoryStore.
  app.set('sessionStore', sessionStore ?? null);
  app.use(
    session({
      name: config.session.cookieName,
      secret: config.session.secret,
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.isProd,
        maxAge: config.session.maxAgeMs,
      },
    }),
  );

  app.use(container.attachUser);

  // --- Static assets --------------------------------------------------------
  app.use(
    express.static(PUBLIC_DIR, {
      index: false,
      maxAge: config.isProd ? '1h' : 0,
      extensions: ['html'],
    }),
  );

  // --- Routes ---------------------------------------------------------------
  app.use('/', healthRoutes);
  app.use('/api', generalApiLimiter, csrfRoutes);
  app.use(
    '/api/auth',
    createAuthRoutes({
      authController: container.authController,
      requireAuth: container.requireAuth,
      guestOnly: container.guestOnly,
    }),
  );
  app.use(
    '/api/integrations',
    createIntegrationRoutes({
      integrationController: container.integrationController,
      requireAuth: container.requireAuth,
    }),
  );

  // Explicit frontend pages.
  app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
  app.get('/dashboard', (req, res) =>
    res.sendFile(path.join(PUBLIC_DIR, 'dashboard.html')),
  );

  // --- 404 handling ---------------------------------------------------------
  // JSON 404 for API routes.
  app.use('/api', notFoundHandler);
  // HTML 404 page for everything else.
  app.use((req, res) => {
    res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
  });

  // --- Centralized error handler (last) -------------------------------------
  app.use(errorHandler);

  return app;
}

export default createApp;

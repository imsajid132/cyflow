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
import { redactUrl } from './utils/redaction.js';
import healthRoutes from './routes/healthRoutes.js';
import csrfRoutes from './routes/csrfRoutes.js';
import { createAuthRoutes } from './routes/authRoutes.js';
import { createIntegrationRoutes } from './routes/integrationRoutes.js';
import { createOAuthRoutes } from './routes/oauthRoutes.js';
import { createSocialAccountRoutes } from './routes/socialAccountRoutes.js';
import { createPostRoutes } from './routes/postRoutes.js';
import { createMediaRoutes } from './routes/mediaRoutes.js';
import { createMediaLibraryRoutes } from './routes/mediaLibraryRoutes.js';
import { createBusinessProfileRoutes } from './routes/businessProfileRoutes.js';
import { createPlannerRoutes } from './routes/plannerRoutes.js';
import { createAutomationRoutes } from './routes/automationRoutes.js';
import { createPublishRoutes } from './routes/publishRoutes.js';
import { buildContainer } from './container.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

/**
 * Front-end routes served by the single application shell. Listing them
 * explicitly (rather than a catch-all) keeps unknown paths on the real 404 page.
 */
export const APP_ROUTES = Object.freeze([
  '/',
  // F: public marketing site (no auth; served the same shell).
  '/features',
  '/how-it-works',
  '/security',
  '/about',
  '/contact',
  '/privacy',
  '/terms',
  '/login',
  '/register',
  '/onboarding',
  '/onboarding/business',
  '/onboarding/brand',
  '/onboarding/connections',
  '/dashboard',
  '/brand',
  '/connections',
  '/create',
  '/queue',
  '/calendar',
  // C3 media library. Exact match only; /media/:token is the content route.
  '/media',
  '/integrations',
  '/profile',
  '/settings',
  // D1: always-on content automations.
  '/automations',
  // Phase 4.7: auto content planner.
  '/planner',
  '/planner/new',
  '/planner/week',
  '/planner/history',
]);

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

  /*
   * --- Security headers -----------------------------------------------------
   *
   * Phase 4.8 TIGHTENED this. The policy used to allow
   * https://cdn.tailwindcss.com as a script and style host, plus 'unsafe-eval',
   * because 404.html pulled the Tailwind Play CDN (which JIT-compiles in the
   * browser and therefore needs eval). That page now uses the local design
   * system, and it was the only Tailwind consumer in the app, so those
   * permissions were purely dead surface: a third-party script origin and
   * arbitrary code evaluation, allowed for a page that no longer wants them.
   *
   * The frontend is vanilla ES modules with one local stylesheet, so 'self' is
   * all it needs. No inline SCRIPT is permitted, and there is none.
   *
   * 'unsafe-inline' remains for STYLE only, and its real consumers are a handful
   * of `style=` attributes in the shell and the page modules (the noscript
   * notice, a few one-off flex gaps). It is not needed by the image layouts:
   * those emit no style attributes, and they render at HCTI rather than being
   * served by this app, so this policy never applies to them. Moving those few
   * declarations into design-system.css would let 'unsafe-inline' go entirely.
   */
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          // https: covers a business's own logo and generated image previews.
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
  // A custom `safeurl` token redacts sensitive OAuth query params (code, state,
  // tokens, secrets) so the raw callback URL is NEVER written to logs.
  app.use(requestId);
  morgan.token('id', (req) => req.id);
  morgan.token('safeurl', (req) => redactUrl(req.originalUrl));
  const logFormat = config.isProd
    ? ':id :method :safeurl :status :res[content-length] - :response-time ms'
    : ':method :safeurl :status :response-time ms';
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
  app.use(
    '/api/oauth',
    createOAuthRoutes({
      oauthController: container.oauthController,
      threadsCallbackController: container.threadsCallbackController,
      requireAuth: container.requireAuth,
    }),
  );
  app.use(
    '/api/social-accounts',
    createSocialAccountRoutes({
      socialAccountController: container.socialAccountController,
      requireAuth: container.requireAuth,
    }),
  );
  app.use(
    '/api/posts',
    createPostRoutes({
      postController: container.postController,
      requireAuth: container.requireAuth,
    }),
  );
  app.use(
    '/api/planner',
    createPlannerRoutes({
      plannerController: container.plannerController,
      requireAuth: container.requireAuth,
    }),
  );
  app.use(
    '/api/business-profile',
    createBusinessProfileRoutes({
      businessProfileController: container.businessProfileController,
      requireAuth: container.requireAuth,
    }),
  );
  // D1: content automations (always-on preparation + rolling buffer).
  app.use(
    '/api/automations',
    createAutomationRoutes({
      automationController: container.automationController,
      requireAuth: container.requireAuth,
    }),
  );
  // D2: per-target publishing actions (retry / cancel / attempt history).
  app.use(
    '/api/publish',
    createPublishRoutes({
      publishController: container.publishController,
      requireAuth: container.requireAuth,
    }),
  );
  // Authenticated media library: upload, list, reuse, references (C3).
  app.use(
    '/api/media',
    createMediaLibraryRoutes({
      mediaLibraryController: container.mediaLibraryController,
      requireAuth: container.requireAuth,
      parseSingleImage: container.parseSingleImage,
    }),
  );
  // Public media content by opaque token (no session/CSRF; local bytes or
  // SSRF-safe HCTI proxy). The token is the only handle and is unguessable.
  app.use('/media', createMediaRoutes({ mediaController: container.mediaController }));

  // --- Frontend application shell -------------------------------------------
  // Every app route serves the same shell so direct navigation and refresh work
  // (the client router then renders the matching page module).
  app.get(APP_ROUTES, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'app.html')));

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

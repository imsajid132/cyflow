/**
 * PM2 example — Cyflow Social staging.
 *
 * EXAMPLE. Review before use. Contains no secrets, no real paths and no real
 * domains by design.
 *
 * Two persistent processes only. The scheduler is NOT here: it runs from host
 * cron as `npm run scheduler:once`. Running a persistent scheduler here *and* a
 * cron entry would double-schedule every due job, which for publishing means
 * two real posts from one scheduled post.
 *
 *   pm2 start deploy/pm2/ecosystem.config.cjs --env staging
 *   pm2 logs cyflow-worker
 *   pm2 reload cyflow-web          # zero-downtime for the web process
 *   pm2 stop cyflow-worker         # SIGTERM; the worker finishes its job first
 *
 * Environment is supplied by the host, NOT by this file. Point PM2 at a private
 * env file or export the variables in the service account's profile. A secret
 * written here would be committed.
 */

module.exports = {
  apps: [
    {
      name: 'cyflow-web',
      script: 'src/server.js',
      // Single instance. Clustering is safe for the HTTP layer but has not been
      // verified against the session store and rate limiter, so it stays off
      // until someone tests it deliberately.
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      // A restart loop should be visible, not silently absorbed.
      max_restarts: 10,
      min_uptime: '30s',
      // server.js handles SIGTERM: stops accepting, drains, closes the pool.
      kill_timeout: 15000,
      wait_ready: false,
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'cyflow-worker',
      script: 'src/workers/worker.js',
      // Exactly one worker to start with. Jobs are lease-protected, so more than
      // one is safe in principle — but prove the lease behaviour under real load
      // before scaling, because the failure mode is a duplicate provider post.
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',
      // Longer than the web process: the worker stops claiming immediately but
      // lets the in-flight job reach a safe boundary. Must exceed the longest
      // expected job, or PM2 kills a job mid-flight and the lease has to expire
      // before anything else can pick it up.
      kill_timeout: 30000,
      env: { NODE_ENV: 'production' },
    },
  ],
};

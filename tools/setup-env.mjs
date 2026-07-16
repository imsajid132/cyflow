/**
 * Minimal env bootstrap for build/review tools that import src/config/env.js.
 * Throwaway non-secret values, identical in spirit to tests/helpers/setupEnv.js.
 * Nothing here is a real credential.
 */
function set(key, value) {
  if (process.env[key] === undefined || process.env[key] === '') process.env[key] = value;
}
set('NODE_ENV', 'test');
set('PORT', '3000');
set('PUBLIC_BASE_URL', 'http://localhost:3000');
set('DB_HOST', '127.0.0.1');
set('DB_PORT', '3306');
set('DB_USER', 'tool');
set('DB_PASSWORD', 'tool');
set('DB_NAME', 'tool');
set('SESSION_SECRET', 'tool-session-secret-not-a-real-secret-0000');
set('ENCRYPTION_KEY_BASE64', Buffer.from('0'.repeat(32)).toString('base64'));
set('OPENAI_API_KEY', '');
set('OPENAI_TEXT_MODEL', 'gpt-test');

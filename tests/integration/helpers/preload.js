/**
 * Preload that points the application at the disposable test database.
 *
 * Must run through `node --import`, not as a normal import. ES module imports
 * are hoisted, so anything written at the top of a test file executes AFTER
 * every import in it has already been evaluated — and src/config/env.js
 * validates and freezes process.env the moment it is first imported. Setting
 * the variables from inside the test file was therefore always too late, and
 * the pool connected to the default 3306 instead.
 */
const map = {
  CYFLOW_TEST_DB_HOST: 'DB_HOST',
  CYFLOW_TEST_DB_PORT: 'DB_PORT',
  CYFLOW_TEST_DB_USER: 'DB_USER',
  CYFLOW_TEST_DB_PASSWORD: 'DB_PASSWORD',
  CYFLOW_TEST_DB_NAME: 'DB_NAME',
};
for (const [from, to] of Object.entries(map)) {
  if (process.env[from] !== undefined && process.env[from] !== '') process.env[to] = process.env[from];
}

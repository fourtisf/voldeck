/**
 * PM2 process file — three services on the Hostinger VPS.
 *   pm2 start ecosystem.config.js && pm2 save && pm2 startup
 * Env comes from the repo-root .env (worker/api load it themselves;
 * the web app only needs the port set here).
 */
module.exports = {
  apps: [
    {
      name: 'volread-web',
      cwd: './apps/web',
      // real JS entry — pnpm's .bin shims are shell scripts, which pm2's
      // node interpreter cannot execute (instant crash loop)
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3020',
      max_memory_restart: '512M',
      time: true,
    },
    {
      name: 'volread-api',
      cwd: './apps/api',
      script: 'dist/index.js',
      max_memory_restart: '384M',
      time: true,
    },
    {
      name: 'volread-worker',
      cwd: './apps/worker',
      script: 'dist/index.js',
      max_memory_restart: '384M',
      time: true,
    },
  ],
};

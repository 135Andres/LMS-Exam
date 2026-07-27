module.exports = {
  apps: [
    {
      name: 'lms-backend',
      cwd: './backend',
      script: 'dist/server.js',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'lms-worker',
      cwd: './backend',
      script: 'dist/src/workers/cron-entry.js',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'lms-auth-python',
      cwd: './backend-python',
      script: 'venv/bin/uvicorn',
      args: 'main:app --host 0.0.0.0 --port 3001',
      interpreter: 'none',
    },
  ],
};

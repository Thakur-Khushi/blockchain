import { createApp } from './app.js';
import { config } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';

async function main() {
  await connectDatabase(config.MONGODB_URI);
  console.log('[server] connected to MongoDB');

  const app = createApp();
  const server = app.listen(config.PORT, () => {
    console.log(`[server] MindChain API listening on http://localhost:${config.PORT}`);
  });

  const shutdown = async (signal) => {
    console.log(`[server] ${signal} received, shutting down`);
    server.close();
    await disconnectDatabase();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[server] failed to start:', err.message);
  process.exit(1);
});

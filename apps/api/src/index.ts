import './setup.js';
import { buildServer } from './server.js';
const start = async () => {
  const server = buildServer();

  const port = parseInt(process.env.PORT || '3001', 10);
  const host = process.env.HOST || '0.0.0.0';

  try {
    await server.listen({ port, host });
    console.log(`Server listening at http://${host}:${port}`);
    console.log(`Environment: ${process.env.NODE_ENV}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();

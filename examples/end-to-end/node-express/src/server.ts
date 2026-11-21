import { createApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const { app, clikgate } = createApp(config);

const server = app.listen(config.port, () => console.log(`Listening on http://localhost:${config.port}`));

// Send any goals still queued before the process exits.
process.on('SIGTERM', () => server.close(() => void clikgate.close()));

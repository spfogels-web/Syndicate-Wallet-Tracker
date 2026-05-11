import express, { type Application, type Request } from 'express';
import { logger } from '../utils/logger';
import { healthRouter } from './routes/health';
import { webhookRouter } from './routes/webhooks';
import { apiRouter } from './routes/api';
import { dashboardRouter } from './routes/dashboard';

export function createApp(): Application {
  const app = express();

  // Capture raw body for webhook signature verification while still parsing JSON.
  app.use(
    express.json({
      limit: '5mb',
      verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  // Form posts (dashboard login)
  app.use(express.urlencoded({ extended: false }));

  app.use((req, _res, next) => {
    logger.debug({ method: req.method, path: req.path }, 'http request');
    next();
  });

  app.use('/', healthRouter);
  app.use('/webhooks', webhookRouter);
  app.use('/api/v1', apiRouter);
  app.use('/', dashboardRouter);

  // 404
  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  // Error handler
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err }, 'unhandled express error');
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}

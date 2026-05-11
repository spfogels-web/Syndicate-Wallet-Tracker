import { Router } from 'express';
import { handleSolanaWebhook } from '../../chains/solana/webhook';
import { handleEthereumWebhook } from '../../chains/ethereum/webhook';
import { handleBaseWebhook } from '../../chains/base/webhook';

export const webhookRouter = Router();

webhookRouter.post('/solana', handleSolanaWebhook);
webhookRouter.post('/ethereum', handleEthereumWebhook);
webhookRouter.post('/base', handleBaseWebhook);

import { makeEvmWebhookHandler } from '../evm/webhook';
export { getEvmClient as getBaseClient } from '../evm/client';
export const handleBaseWebhook = makeEvmWebhookHandler('BASE');

import { makeEvmWebhookHandler } from '../evm/webhook';
export { getEvmClient as getEthereumClient } from '../evm/client';
export const handleEthereumWebhook = makeEvmWebhookHandler('ETHEREUM');

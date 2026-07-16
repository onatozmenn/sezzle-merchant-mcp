const resourcePath = (resourceId: string): string => encodeURIComponent(resourceId);

export const sezzleEndpoints = {
  authentication: '/v2/authentication',
  sessions: '/v2/session',
  session: (sessionUuid: string) => `/v2/session/${resourcePath(sessionUuid)}`,
  order: (orderUuid: string) => `/v2/order/${resourcePath(orderUuid)}`,
  checkout: (orderUuid: string) => `/v2/order/${resourcePath(orderUuid)}/checkout`,
  capture: (orderUuid: string) => `/v2/order/${resourcePath(orderUuid)}/capture`,
  refund: (orderUuid: string) => `/v2/order/${resourcePath(orderUuid)}/refund`,
  release: (orderUuid: string) => `/v2/order/${resourcePath(orderUuid)}/release`,
  reauthorize: (orderUuid: string) => `/v2/order/${resourcePath(orderUuid)}/reauthorize`,
  settlementSummaries: '/v2/settlements/summaries',
  settlementDetails: (payoutUuid: string) => `/v2/settlements/details/${resourcePath(payoutUuid)}`,
  orderReport: '/v2/orders/report',
  interestBalance: '/v2/interest/balance',
  interestActivity: '/v2/interest/activity',
  webhooks: '/v2/webhooks',
  webhook: (webhookUuid: string) => `/v2/webhooks/${resourcePath(webhookUuid)}`,
  webhookTest: '/v2/webhooks/test',
} as const;

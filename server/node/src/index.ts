/**
 * The official Clikgate server SDK for Node.js and TypeScript.
 *
 * @example
 * import { Clikgate, Provider } from '@clikgate/node';
 * const clikgate = new Clikgate();                       // reads CLIKGATE_API_KEY
 * clikgate.goal('account_opened', { clickId, reference: 'APP-55231', value: '2000000' });
 * clikgate.goal('order_paid', { clickId, reference: 'T123456', provider: Provider.Paystack, value: '7500' }); // a Payment goal
 *
 * @packageDocumentation
 */
export { Clikgate, type ClikgateOptions, type IdentifyUserParams, type PersonIdentified } from './client.js';
export {
  ClickIds,
  clickIds,
  isValid as isValidClickId,
  CLICK_ID_PATTERN,
  CLICK_ID_HEADER,
  KEPT_COOKIE,
  KEPT_BY,
  BROWSER_ENGINES,
  PLATFORMS,
  type PersistOptions,
  type RequestLike,
  type ResponseLike,
  type KeptBy,
  type BrowserEngine,
  type Platform,
  type ClickContext,
  type KeepRoute,
  type KeepRouteOptions,
  type KeepInput,
  type KeepResult,
} from './click-ids.js';
export { webhooks, type VerifyOptions, type RawBody } from './webhooks.js';
export { formatValue, type MoneyInput } from './money.js';
export { hashForAds, type HashForAdsInput, type HashedIdentifiers } from './ads-hashing.js';
export { GoalKind, GoalStatus, Provider } from './enums.js';
export type { GoalOptions, GoalBatchEvent, ReverseOptions } from './goals.js';
export type { ErrorContext, OnError } from './core.js';
export type { Logger, WarningCode } from './logger.js';
export type { Clock, RequestOptions } from './http.js';
export type { FetchLike } from './transport.js';
export type { QrOptions, LinkIterator, Conversions, Links, Clicks } from './resources.js';
export type { Goals } from './goals.js';
export {
  buildFromPaystack,
  buildFromFlutterwave,
  buildFromMonnify,
  buildFromStripe,
  type Payments,
  type PaymentStatus,
  type PaymentConfirmParams,
  type PaymentConfirmation,
  type PaymentConfirmationBody,
  type PaymentHelperOptions,
} from './payments.js';
export type {
  GoalEvent,
  GoalAttribution,
  GoalPayment,
  GoalBatchItem,
  GoalBatchResult,
  Link,
  LinkWarning,
  LinkChangeRequest,
  LinkUpdateResult,
  Click,
  Conversion,
  ListPage,
  ServerSdkConfig,
  ConfigGoal,
  WebhookEvent,
  QrCode,
} from './types.js';
export {
  ClikgateError,
  ConfigurationError,
  AuthenticationError,
  PermissionError,
  InvalidRequestError,
  PrivateModeFieldRejectedError,
  NotFoundError,
  ConflictError,
  LinkLockedError,
  IdempotencyError,
  RateLimitError,
  ServerError,
  NetworkError,
  TimeoutError,
  SignatureVerificationError,
  type KnownErrorCode,
} from './errors.js';
export { VERSION } from './version.js';
/** Types of the generated `clikgate.api.*` layer (request bodies and responses, as in openapi.json). */
export type * as ApiTypes from './generated/index.js';
export type { ApiClient } from './generated/index.js';

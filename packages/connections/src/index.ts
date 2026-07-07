/** Public surface of the Cyflow connections vault (server-only). */
export {
  EncryptionService,
  createEncryptionService,
  encryptionFromEnv,
  keyFromSecret,
} from "./crypto";
export { credentialsSchema, validateCredentials } from "./auth";
export {
  buildAuthorizationUrl,
  exchangeCodeForToken,
  refreshAccessToken,
} from "./oauth2";
export type { OAuth2ProviderConfig, OAuth2Tokens, TokenRefresher } from "./oauth2";
export {
  ConnectionService,
  InMemoryConnectionStore,
} from "./service";
export type { CreateConnectionInput, UpdateConnectionInput } from "./service";
export {
  GOOGLE_APPS,
  GOOGLE_SCOPES,
  GOOGLE_LABELS,
  googleConfigFromEnv,
  googleAuthorizeUrl,
  exchangeGoogleCode,
  refreshGoogleToken,
  fetchGoogleEmail,
  makeOAuthState,
  readOAuthState,
  tokensToCredentials,
  makeGoogleGetConnection,
} from "./google";
export type { GoogleConfig, GoogleCredentials } from "./google";
export {
  MICROSOFT_APPS,
  MICROSOFT_SCOPES,
  MICROSOFT_LABELS,
  microsoftConfigFromEnv,
  microsoftAuthorizeUrl,
  exchangeMicrosoftCode,
  refreshMicrosoftToken,
  fetchMicrosoftEmail,
  makeMicrosoftState,
  readMicrosoftState,
  makeCloudGetConnection,
} from "./microsoft";
export type { MicrosoftConfig } from "./microsoft";

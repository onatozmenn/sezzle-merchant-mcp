import type { AppConfig } from '../config/env.js';
import { SecretValue } from '../config/env.js';
import { SezzleOpsError } from './errors.js';
import { sezzleEndpoints } from './endpoint-catalog.js';
import type { ApiResponse, HttpClient } from './request.js';
import { authenticationResponseSchema, type AuthenticationResponse } from './schemas/phase1.js';

export interface MerchantAuthentication {
  readonly merchantUuid: string;
  readonly expiresAt: string;
  readonly requestId: string;
}

interface TokenState {
  readonly token: SecretValue;
  readonly merchantUuid: string;
  readonly expiresAt: string;
  readonly expiresAtMilliseconds: number;
}

export class AuthClient {
  readonly #config: AppConfig;
  readonly #http: HttpClient;
  readonly #now: () => number;
  #state: TokenState | undefined;
  #inFlight: Promise<MerchantAuthentication> | undefined;

  public constructor(config: AppConfig, http: HttpClient, now: () => number = Date.now) {
    this.#config = config;
    this.#http = http;
    this.#now = now;
  }

  public getCurrentAuthentication(): Omit<MerchantAuthentication, 'requestId'> | undefined {
    if (this.#state === undefined) return undefined;
    return { merchantUuid: this.#state.merchantUuid, expiresAt: this.#state.expiresAt };
  }

  public async authenticate(force = false): Promise<MerchantAuthentication> {
    if (
      !force &&
      this.#state !== undefined &&
      this.#state.expiresAtMilliseconds > this.#now() + 60_000
    ) {
      return {
        merchantUuid: this.#state.merchantUuid,
        expiresAt: this.#state.expiresAt,
        requestId: '',
      };
    }
    if (this.#inFlight !== undefined) return this.#inFlight;
    const authentication = this.#acquireToken();
    this.#inFlight = authentication;
    try {
      return await authentication;
    } finally {
      this.#inFlight = undefined;
    }
  }

  public async getBearerToken(force = false): Promise<string> {
    await this.authenticate(force);
    if (this.#state === undefined) {
      throw new SezzleOpsError({
        code: 'AUTHENTICATION_FAILED',
        message: 'Authentication did not produce an access token.',
        retryable: false,
        httpStatus: 401,
        details: {},
      });
    }
    return this.#state.token.reveal();
  }

  async #acquireToken(): Promise<MerchantAuthentication> {
    const apiKey = this.#config.sezzle.apiKey;
    const apiSecret = this.#config.sezzle.apiSecret;
    if (apiKey === undefined || apiSecret === undefined) {
      throw new SezzleOpsError({
        code: 'AUTHENTICATION_NOT_CONFIGURED',
        message: 'SEZZLE_API_KEY and SEZZLE_API_SECRET must be configured.',
        retryable: false,
        httpStatus: 401,
        details: {},
      });
    }

    const response: ApiResponse<AuthenticationResponse> = await this.#http.requestJson(
      {
        method: 'POST',
        path: sezzleEndpoints.authentication,
        headers: {},
        body: { public_key: apiKey.reveal(), private_key: apiSecret.reveal() },
        retryable: true,
      },
      authenticationResponseSchema,
    );
    const configuredMerchant = this.#config.sezzle.merchantUuid;
    if (configuredMerchant !== undefined && configuredMerchant !== response.data.merchant_uuid) {
      this.#state = undefined;
      throw new SezzleOpsError({
        code: 'MERCHANT_ID_MISMATCH',
        message: 'Authenticated merchant does not match SEZZLE_MERCHANT_UUID.',
        retryable: false,
        httpStatus: 403,
        requestId: response.requestId,
        details: {},
      });
    }

    const expiresAtMilliseconds = Date.parse(response.data.expiration_date);
    this.#state = {
      token: new SecretValue(response.data.token),
      merchantUuid: response.data.merchant_uuid,
      expiresAt: response.data.expiration_date,
      expiresAtMilliseconds,
    };
    return {
      merchantUuid: response.data.merchant_uuid,
      expiresAt: response.data.expiration_date,
      requestId: response.requestId,
    };
  }
}

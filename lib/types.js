/**
 * Shared JSDoc types. No runtime exports: this module exists so editors and
 * `node --test` type checks can name the shapes the plugin passes around.
 *
 * @module dsh-turbo-mode/types
 */

/**
 * One measured model request.
 * @typedef {object} RequestMetric
 * @property {number} at - epoch milliseconds when the request started.
 * @property {string} host - endpoint hostname.
 * @property {string} [provider] - Harness provider route, when known.
 * @property {string} [model] - model id sent to the endpoint.
 * @property {'standard' | 'fast'} speed - speed the session was in.
 * @property {string} [requestedParam] - priority parameter sent, if any.
 * @property {string} [echoedTier] - tier the endpoint echoed back, if any.
 * @property {number} [status] - HTTP status.
 * @property {boolean} ok - whether the exchange completed without a provider error.
 * @property {number} [headersMs] - milliseconds until response headers.
 * @property {number} [firstTokenMs] - milliseconds until the first streamed byte.
 * @property {number} [totalMs] - milliseconds until the stream ended.
 * @property {number} [outputTokens] - usage reported by the provider.
 * @property {boolean} [estimatedTokens] - true when token counts came from a heuristic.
 * @property {number} [tokensPerSecond] - output tokens divided by generation time.
 * @property {boolean} [retried] - whether an earlier attempt for this turn was retried.
 * @property {string} [errorCode] - normalized failure code when `ok` is false.
 */

/**
 * One capability probe outcome.
 * @typedef {object} ProbeResult
 * @property {'accepted-faster' | 'accepted-no-effect' | 'rejected' | 'inconclusive'} verdict
 * @property {string} host
 * @property {string} model
 * @property {number} [deltaPct] - first-token change, positive meaning Fast was faster.
 * @property {number} [standardMedianMs]
 * @property {number} [fastMedianMs]
 * @property {number} samples
 * @property {string} [detail]
 */

export {}

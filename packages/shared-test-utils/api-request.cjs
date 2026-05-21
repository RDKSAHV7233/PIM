/**
 * Resilient API request utility for integration tests
 * Handles rate limiting, transient failures, and concurrent request management
 */

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_INITIAL_BACKOFF_MS = 500;
const DEFAULT_MAX_BACKOFF_MS = 8_000;

/**
 * Calculate exponential backoff with jitter
 * @param {number} attempt - Current attempt number (0-indexed)
 * @param {number} initialBackoffMs - Initial backoff duration
 * @param {number} maxBackoffMs - Maximum backoff duration
 * @returns {number} Backoff duration in milliseconds
 */
function calculateBackoff(attempt, initialBackoffMs, maxBackoffMs) {
  const exponentialBackoff = Math.min(
    initialBackoffMs * Math.pow(2, attempt),
    maxBackoffMs
  );
  // Add jitter: ±20% of calculated backoff
  const jitter = exponentialBackoff * 0.2 * (Math.random() - 0.5);
  return Math.max(100, exponentialBackoff + jitter);
}

/**
 * Sleep for specified duration
 * @param {number} ms - Duration in milliseconds
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Perform HTTP request with automatic retry and backoff logic
 * @param {string} url - Request URL
 * @param {Object} options - Fetch options
 * @param {Object} retryConfig - Retry configuration
 * @returns {Promise<Object>} Response with status and parsed payload
 */
async function apiRequestWithRetry(url, options = {}, retryConfig = {}) {
  const maxRetries = retryConfig.maxRetries ?? DEFAULT_MAX_RETRIES;
  const timeoutMs = retryConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const initialBackoffMs = retryConfig.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
  const maxBackoffMs = retryConfig.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  const isRateLimited = retryConfig.isRateLimited ?? ((status) => status === 429);
  const isTransient = retryConfig.isTransient ?? ((status) => [502, 503, 504].includes(status));

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const fetchOptions = {
        ...options,
        signal: AbortSignal.timeout(timeoutMs),
      };

      const response = await fetch(url, fetchOptions);
      const text = await response.text();

      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = text;
      }

      // Success case
      if (response.ok) {
        return { status: response.status, payload };
      }

      // Rate limited: use exponential backoff
      if (isRateLimited(response.status) && attempt < maxRetries) {
        const backoff = calculateBackoff(attempt, initialBackoffMs, maxBackoffMs);
        console.warn(
          `[API Request] Rate limited (429). Attempt ${attempt + 1}/${maxRetries + 1}. ` +
          `Backing off ${Math.round(backoff)}ms...`
        );
        await sleep(backoff);
        continue;
      }

      // Transient error: use shorter backoff
      if (isTransient(response.status) && attempt < maxRetries) {
        const backoff = Math.min(1_000 * (attempt + 1), maxBackoffMs);
        console.warn(
          `[API Request] Transient error (${response.status}). Attempt ${attempt + 1}/${maxRetries + 1}. ` +
          `Backing off ${Math.round(backoff)}ms...`
        );
        await sleep(backoff);
        continue;
      }

      // Non-retryable error or out of retries
      return { status: response.status, payload };
    } catch (error) {
      lastError = error;

      // Retry on network errors
      if (attempt < maxRetries && error instanceof TypeError) {
        const backoff = Math.min(300 * (attempt + 1), maxBackoffMs);
        console.warn(
          `[API Request] Network error: ${error.message}. ` +
          `Attempt ${attempt + 1}/${maxRetries + 1}. Backing off ${Math.round(backoff)}ms...`
        );
        await sleep(backoff);
        continue;
      }

      // Non-retryable error
      if (attempt >= maxRetries) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("Request failed after all retries");
}

/**
 * Create a request debouncer to prevent thundering herd on endpoints
 * Useful for multiple tests hammering login endpoint simultaneously
 * @param {number} delayMs - Minimum delay between requests
 * @returns {Function} Debounced request function
 */
function createDebouncedRequester(delayMs = 100) {
  let lastRequestTime = 0;

  return async (url, options, retryConfig) => {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    const remainingDelay = Math.max(0, delayMs - timeSinceLastRequest);

    if (remainingDelay > 0) {
      await sleep(remainingDelay);
    }

    lastRequestTime = Date.now();
    return apiRequestWithRetry(url, options, retryConfig);
  };
}

/**
 * Assert HTTP response status matches expectation
 * @param {Object} result - Response object from apiRequestWithRetry
 * @param {number|number[]} expected - Expected status code(s)
 * @param {string} context - Error message context
 * @throws {Error} If status doesn't match expected
 */
function assertStatus(result, expected, context) {
  const expectedStatuses = Array.isArray(expected) ? expected : [expected];
  if (!expectedStatuses.includes(result.status)) {
    throw new Error(
      `${context} failed: expected ${expectedStatuses.join("/")}` +
      `, got ${result.status}; payload=${JSON.stringify(result.payload)}`
    );
  }
}

module.exports = {
  apiRequestWithRetry,
  createDebouncedRequester,
  assertStatus,
  calculateBackoff,
  sleep,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_INITIAL_BACKOFF_MS,
  DEFAULT_MAX_BACKOFF_MS,
};

import { getLocaleHeader } from "@lib/util/get-locale-header"
import Medusa, { FetchArgs, FetchInput } from "@medusajs/js-sdk"

const MEDUSA_BACKEND_URL =
  typeof window === "undefined"
    ? process.env.MEDUSA_BACKEND_URL_INTERNAL ||
      process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL
    : process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL

if (!MEDUSA_BACKEND_URL && process.env.NODE_ENV === "production") {
  throw new Error(
    "Set MEDUSA_BACKEND_URL_INTERNAL or NEXT_PUBLIC_MEDUSA_BACKEND_URL to a reachable Medusa API URL."
  )
}

export const sdk = new Medusa({
  baseUrl: MEDUSA_BACKEND_URL || "http://localhost:9000",
  debug: process.env.NODE_ENV === "development",
  publishableKey: process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY,
})

const originalFetch = sdk.client.fetch.bind(sdk.client)

sdk.client.fetch = async <T>(
  input: FetchInput,
  init?: FetchArgs
): Promise<T> => {
  const headers = init?.headers ?? {}
  let localeHeader: Record<string, string | null> | undefined
  try {
    localeHeader = await getLocaleHeader()
    headers["x-medusa-locale"] ??= localeHeader["x-medusa-locale"]
  } catch {}

  const newHeaders = {
    ...localeHeader,
    ...headers,
  }
  init = {
    ...init,
    headers: newHeaders,
  }
  return originalFetch(input, init)
}

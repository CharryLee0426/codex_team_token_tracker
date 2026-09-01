import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, detectLocale, isLocale, type Locale } from "./config";

export default getRequestConfig(async () => {
  const store = await cookies();
  const fromCookie = store.get(LOCALE_COOKIE)?.value;
  let locale: Locale;
  if (isLocale(fromCookie)) {
    locale = fromCookie;
  } else {
    const h = await headers();
    locale = detectLocale(h.get("accept-language"));
  }
  const messages = (await import(`../messages/${locale}.json`)).default;
  // Server-side default only; all user-facing dates are formatted on the client in the machine time zone.
  return { locale, messages, timeZone: "UTC" };
});

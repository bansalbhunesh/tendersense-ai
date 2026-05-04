import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import hi from "./locales/hi.json";

export const NS = ["common", "auth", "dashboard", "workspace", "review", "graph", "errors"] as const;
export const LANG_STORAGE_KEY = "ts_lang";

function syncDocumentLang(lng?: string) {
  if (typeof document === "undefined") return;
  const raw = (lng ?? "en").split("-")[0] ?? "en";
  document.documentElement.lang = raw === "hi" ? "hi" : "en";
}

// We keep the locale files split into namespaces (common/auth/...) for
// readability and reviewability, but merge them into a single i18next
// "translation" bundle so callers can use plain dotted keys like
// `t("auth.signIn")` without namespace separators.
const enResources = { translation: en };
const hiResources = { translation: hi };

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: enResources,
      hi: hiResources,
    },
    fallbackLng: "en",
    supportedLngs: ["en", "hi"],
    defaultNS: "translation",
    ns: ["translation"],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: LANG_STORAGE_KEY,
      caches: ["localStorage"],
    },
    returnNull: false,
  })
  .then(() => {
    syncDocumentLang(i18n.resolvedLanguage || i18n.language);
    i18n.on("languageChanged", (lng) => {
      syncDocumentLang(lng);
    });
  });

export default i18n;

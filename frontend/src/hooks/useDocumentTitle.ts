import { useEffect } from "react";
import { useTranslation } from "react-i18next";

/**
 * Sets document.title from an i18n key (e.g. "auth.documentTitle"). The title
 * re-evaluates if the active language changes, so manual EN/HI toggling
 * updates the browser tab synchronously.
 */
export function useDocumentTitle(key: string) {
  const { t, i18n } = useTranslation();
  useEffect(() => {
    const previous = document.title;
    document.title = t(key);
    return () => {
      document.title = previous;
    };
  }, [key, t, i18n.language]);
}

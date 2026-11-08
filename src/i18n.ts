import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import ru from "./locales/ru.json";
import de from "./locales/de.json";

const saved = (typeof localStorage !== "undefined" && localStorage.getItem("world_radio_lang")) || "";
const browser = typeof navigator !== "undefined" ? navigator.language?.slice(0, 2) : "en";
const initial = saved || (["en", "ru", "de"].includes(browser) ? browser : "en");

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ru: { translation: ru }, de: { translation: de } },
  lng: initial,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
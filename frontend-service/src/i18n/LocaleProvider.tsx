import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { translators, type Locale } from './messages';

const STORAGE_KEY = 'ekt-interface-language';
function savedLocale(): Locale {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'kk' ? 'kk' : 'ru';
  } catch {
    return 'ru';
  }
}
const LocaleContext = createContext({
  locale: 'ru' as Locale,
  setLocale: (_locale: Locale) => {
    void _locale;
  },
  t: translators.ru,
  dateLocale: 'ru-RU',
});
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState(savedLocale);
  const t = translators[locale];
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t('Электрокомплект · Чат-помощник');
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute(
        'content',
        t('Помощник Электрокомплект: поиск товаров, характеристики и наличие.'),
      );
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Keep switching usable when browser storage is unavailable.
    }
  }, [locale, t]);
  return (
    <LocaleContext.Provider
      value={{
        locale,
        setLocale,
        t,
        dateLocale: locale === 'kk' ? 'kk-KZ' : 'ru-RU',
      }}
    >
      {children}
    </LocaleContext.Provider>
  );
}
export function useLocale() {
  return useContext(LocaleContext);
}
export function LanguageSwitch() {
  const { locale, setLocale, t } = useLocale();
  return (
    <div
      className="language-switch"
      role="group"
      aria-label={t('Язык интерфейса')}
    >
      <button
        type="button"
        lang="ru"
        aria-label="Русский"
        aria-pressed={locale === 'ru'}
        onClick={() => setLocale('ru')}
      >
        RU
      </button>
      <span aria-hidden="true">/</span>
      <button
        type="button"
        lang="kk"
        aria-label="Қазақша"
        aria-pressed={locale === 'kk'}
        onClick={() => setLocale('kk')}
      >
        KZ
      </button>
    </div>
  );
}

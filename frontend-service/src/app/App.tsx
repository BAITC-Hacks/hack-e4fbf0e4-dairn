import { useAuth } from '../features/auth/AuthProvider';
import { useAssistant } from '../features/chat/useAssistant';
import { AppLink, useLocation } from './navigation';
import { LanguageSwitch, useLocale } from '../i18n/LocaleProvider';
import { lazy, Suspense, useState } from 'react';
import { Icon } from '../components/Icon';
import { ChatWidget } from '../features/chat/ChatWidget';
const CartPage = lazy(() =>
  import('../features/cart/CartPage').then((module) => ({
    default: module.CartPage,
  })),
);
export function App() {
  const { credential } = useAuth();
  return <SessionApp key={credential?.access_token || 'guest'} />;
}
function SessionApp() {
  const assistant = useAssistant();
  const location = useLocation();
  const { t } = useLocale();
  const categories = [
    {
      name: t('Кабель и провод'),
      detail: t('Для надёжных соединений'),
      type: 'cable',
      query: t('Помогите подобрать кабель'),
    },
    {
      name: t('Светильники и лампы'),
      detail: t('Свет для каждого пространства'),
      type: 'lamp',
      query: t('Помогите подобрать светильник'),
    },
    {
      name: t('Низковольтная аппаратура'),
      detail: t('Защита и управление'),
      type: 'breaker',
      query: 'DEMO-C16',
    },
    {
      name: t('Монтаж и инструмент'),
      detail: t('Всё для вашей работы'),
      type: 'tools',
      query: t('Какие товары есть в каталоге?'),
    },
  ];

  const [prompt, setPrompt] = useState({ text: '', id: 0 });
  const [search, setSearch] = useState('');
  const ask = (text: string) =>
    setPrompt((previous) => ({ text, id: previous.id + 1 }));
  const isCart = location.split('?')[0] === '/cart';
  return (
    <>
      <a className="skip-link" href="#main">
        {t('Перейти к содержимому')}
      </a>
      <header className="site-header">
        <div className="utility-bar">
          <div className="site-container">
            <span>{t('◎ Алматы')}</span>
            <span>{t('Электротехника для ваших задач')}</span>
            <span>{t('Демонстрация интерфейса')}</span>
            <LanguageSwitch />
          </div>
        </div>
        <div className="site-container main-header">
          <AppLink
            href="/"
            className="brand"
            aria-label={t('Электрокомплект — главная')}
          >
            <span className="brand-symbol">
              <Icon name="bolt" size={34} />
            </span>
            <span>
              {t('ЭЛЕКТРОКОМПЛЕКТ')}
              <small>{t('ЭНЕРГИЯ ВАШИХ РЕШЕНИЙ')}</small>
            </span>
          </AppLink>
          {!isCart && (
            <form
              className="site-search"
              onSubmit={(event) => {
                event.preventDefault();
                if (search.trim()) ask(search);
              }}
            >
              <label className="sr-only" htmlFor="catalog-search">
                {t('Поиск по каталогу')}
              </label>
              <input
                id="catalog-search"
                placeholder={t('Наименование или артикул товара')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <button
                type="submit"
                aria-label={t('Спросить помощника о товаре')}
              >
                <Icon name="search" />
              </button>
            </form>
          )}
          <a
            className="catalog-external"
            href="https://ekt.kz"
            target="_blank"
            rel="noreferrer"
          >
            {t('Сайт ЭКТ')} <Icon name="arrow" size={16} />
          </a>
          <AppLink
            href="/cart"
            className="header-cart"
            aria-label={t('Корзина')}
            aria-current={isCart ? 'page' : undefined}
          >
            <Icon name="cart" size={22} />
            <span>{t('Корзина')}</span>
          </AppLink>
        </div>
        <nav
          className="site-container site-nav"
          aria-label={t('Основная навигация')}
        >
          <a className="catalog-link" href="/#catalog">
            <Icon name="menu" size={19} /> {t('Каталог продукции')}
          </a>
          <a href="https://ekt.kz" target="_blank" rel="noreferrer">
            {t('О компании')}
          </a>
          {!isCart && (
            <>
              <button
                onClick={() => ask(t('Какие условия оплаты и доставки?'))}
              >
                {t('Оплата и доставка')}
              </button>
              <button
                onClick={() => ask(t('Помогите подобрать аналог DEMO-C16-OLD'))}
              >
                {t('Подбор оборудования')}
              </button>
            </>
          )}
          <span>{t('Профессионально. Надёжно. Рядом.')}</span>
        </nav>
      </header>
      {isCart ? (
        <Suspense fallback={<main id="main">{t('Загружаем корзину…')}</main>}>
          <CartPage
            session={assistant.session}
            connecting={assistant.connecting}
            location={location}
          />
        </Suspense>
      ) : (
        <main id="main" tabIndex={-1} className="site-container storefront">
          <section className="hero">
            <div className="hero-copy">
              <span className="eyebrow">
                {t('ЭЛЕКТРОКОМПЛЕКТ · КАЗАХСТАН')}
              </span>
              <h1>
                {t('Правильные решения.')} <br />
                <span>{t('Надёжные соединения.')}</span>
              </h1>
              <p>
                {t('Электротехника для дома, бизнеса')} <br />
                {t('и больших проектов.')}
              </p>
              <a href="#catalog" className="hero-cta">
                {t('Перейти в каталог')} <Icon name="arrow" size={19} />
              </a>
              <span className="hero-caption">
                {t('От выбора оборудования до готового решения')}
              </span>
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="art-grid" />
              <div className="cable-reel reel-back" />
              <div className="cable-reel reel-front" />
              <div className="wire wire-one" />
              <div className="wire wire-two" />
              <div className="art-badge">
                {t('ЭКТ')}
                <span>{t('ЭНЕРГИЯ В ДЕТАЛЯХ')}</span>
              </div>
            </div>
          </section>
          <div className="service-strip">
            <div>
              <span>01</span>
              <p>
                <strong>{t('Помощь в выборе')}</strong>
                <small>{t('Характеристики и аналоги')}</small>
              </p>
            </div>
            <div>
              <span>02</span>
              <p>
                <strong>{t('Наличие по складам')}</strong>
                <small>{t('Проверка актуальных остатков')}</small>
              </p>
            </div>
            <div>
              <span>03</span>
              <p>
                <strong>{t('Работа со спецификацией')}</strong>
                <small>{t('Прикрепите документ в чате')}</small>
              </p>
            </div>
          </div>
          <section id="catalog" className="catalog-section">
            <div className="section-title">
              <div>
                <span className="eyebrow">{t('ВСЁ ДЛЯ ВАШЕГО ПРОЕКТА')}</span>
                <h2>{t('Каталог продукции')}</h2>
              </div>
              <span>{t('Подберите товар с помощником ↗')}</span>
            </div>
            <div className="category-grid">
              {categories.map((category) => (
                <button
                  className="category-card"
                  key={category.type}
                  onClick={() => ask(category.query)}
                >
                  <div
                    className={`category-art ${category.type}`}
                    aria-hidden="true"
                  >
                    {category.type === 'cable' ? (
                      <div className="mini-coil" />
                    ) : category.type === 'lamp' ? (
                      <div className="lightbulb" />
                    ) : category.type === 'breaker' ? (
                      <div className="circuit-breaker">
                        <i />
                        <i />
                        <i />
                      </div>
                    ) : (
                      <div className="tool-shape" />
                    )}
                  </div>
                  <span className="category-name">
                    {category.name}
                    <Icon name="arrow" size={17} />
                  </span>
                  <small>{category.detail}</small>
                </button>
              ))}
            </div>
          </section>
          <section className="help-strip">
            <div>
              <span className="eyebrow">{t('НАЧНИТЕ С ВОПРОСА')}</span>
              <h2>{t('Не знаете, что выбрать?')}</h2>
              <p>
                {t('Наш помощник разберёт артикул, фото или список товаров.')}
              </p>
            </div>
            <button
              className="primary"
              onClick={() => ask(t('Помогите с выбором оборудования'))}
            >
              {t('Открыть помощника')} <Icon name="chat" size={18} />
            </button>
          </section>
        </main>
      )}
      <footer className="site-container site-footer">
        <span>{t('© Электрокомплект · HACKALEM AI')}</span>
        <span>{t('Демо-интерфейс. Реальные условия — на ekt.kz.')}</span>
      </footer>
      <ChatWidget prompt={prompt} assistant={assistant} hidden={isCart} />
    </>
  );
}

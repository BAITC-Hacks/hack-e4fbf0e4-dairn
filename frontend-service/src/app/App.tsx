import { lazy, Suspense, useState } from 'react';
import { Icon } from '../components/Icon';
import { ChatWidget } from '../features/chat/ChatWidget';
const CartPage = lazy(() =>
  import('../features/cart/CartPage').then((module) => ({
    default: module.CartPage,
  })),
);
const categories = [
  {
    name: 'Кабель и провод',
    detail: 'Для надёжных соединений',
    type: 'cable',
    query: 'Помогите подобрать кабель',
  },
  {
    name: 'Светильники и лампы',
    detail: 'Свет для каждого пространства',
    type: 'lamp',
    query: 'Помогите подобрать светильник',
  },
  {
    name: 'Низковольтная аппаратура',
    detail: 'Защита и управление',
    type: 'breaker',
    query: 'DEMO-C16',
  },
  {
    name: 'Монтаж и инструмент',
    detail: 'Всё для вашей работы',
    type: 'tools',
    query: 'Какие товары есть в каталоге?',
  },
];
export function App() {
  const [prompt, setPrompt] = useState({ text: '', id: 0 });
  const [search, setSearch] = useState('');
  const ask = (text: string) =>
    setPrompt((previous) => ({ text, id: previous.id + 1 }));
  const isCart = window.location.pathname === '/cart';
  return (
    <>
      <a className="skip-link" href="#main">
        Перейти к содержимому
      </a>
      <header className="site-header">
        <div className="utility-bar">
          <div className="site-container">
            <span>◎ Алматы</span>
            <span>Электротехника для ваших задач</span>
            <span>Демонстрация интерфейса</span>
          </div>
        </div>
        <div className="site-container main-header">
          <a href="/" className="brand" aria-label="Электрокомплект — главная">
            <span className="brand-symbol">
              <Icon name="bolt" size={34} />
            </span>
            <span>
              ЭЛЕКТРОКОМПЛЕКТ<small>ЭНЕРГИЯ ВАШИХ РЕШЕНИЙ</small>
            </span>
          </a>
          {!isCart && (
            <form
              className="site-search"
              onSubmit={(event) => {
                event.preventDefault();
                if (search.trim()) ask(search);
              }}
            >
              <label className="sr-only" htmlFor="catalog-search">
                Поиск по каталогу
              </label>
              <input
                id="catalog-search"
                placeholder="Наименование или артикул товара"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <button type="submit" aria-label="Спросить помощника о товаре">
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
            Сайт ЭКТ
            <Icon name="arrow" size={16} />
          </a>
        </div>
        <nav
          className="site-container site-nav"
          aria-label="Основная навигация"
        >
          <a className="catalog-link" href="/#catalog">
            <Icon name="menu" size={19} /> Каталог продукции
          </a>
          <a href="https://ekt.kz" target="_blank" rel="noreferrer">
            О компании
          </a>
          {!isCart && (
            <>
              <button onClick={() => ask('Какие условия оплаты и доставки?')}>
                Оплата и доставка
              </button>
              <button
                onClick={() => ask('Помогите подобрать аналог DEMO-C16-OLD')}
              >
                Подбор оборудования
              </button>
            </>
          )}
          <span>Профессионально. Надёжно. Рядом.</span>
        </nav>
      </header>
      {isCart ? (
        <Suspense fallback={<main id="main">Загружаем корзину…</main>}>
          <CartPage />
        </Suspense>
      ) : (
        <main id="main" tabIndex={-1} className="site-container storefront">
          <section className="hero">
            <div className="hero-copy">
              <span className="eyebrow">ЭЛЕКТРОКОМПЛЕКТ · КАЗАХСТАН</span>
              <h1>
                Правильные решения.
                <br />
                <span>Надёжные соединения.</span>
              </h1>
              <p>
                Электротехника для дома, бизнеса
                <br />и больших проектов.
              </p>
              <a href="#catalog" className="hero-cta">
                Перейти в каталог
                <Icon name="arrow" size={19} />
              </a>
              <span className="hero-caption">
                От выбора оборудования до готового решения
              </span>
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="art-grid" />
              <div className="cable-reel reel-back" />
              <div className="cable-reel reel-front" />
              <div className="wire wire-one" />
              <div className="wire wire-two" />
              <div className="art-badge">
                ЭКТ<span>ЭНЕРГИЯ В ДЕТАЛЯХ</span>
              </div>
            </div>
          </section>
          <div className="service-strip">
            <div>
              <span>01</span>
              <p>
                <strong>Помощь в выборе</strong>
                <small>Характеристики и аналоги</small>
              </p>
            </div>
            <div>
              <span>02</span>
              <p>
                <strong>Наличие по складам</strong>
                <small>Проверка актуальных остатков</small>
              </p>
            </div>
            <div>
              <span>03</span>
              <p>
                <strong>Работа со спецификацией</strong>
                <small>Прикрепите документ в чате</small>
              </p>
            </div>
          </div>
          <section id="catalog" className="catalog-section">
            <div className="section-title">
              <div>
                <span className="eyebrow">ВСЁ ДЛЯ ВАШЕГО ПРОЕКТА</span>
                <h2>Каталог продукции</h2>
              </div>
              <span>Подберите товар с помощником ↗</span>
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
              <span className="eyebrow">НАЧНИТЕ С ВОПРОСА</span>
              <h2>Не знаете, что выбрать?</h2>
              <p>Наш помощник разберёт артикул, фото или список товаров.</p>
            </div>
            <button
              className="primary"
              onClick={() => ask('Помогите с выбором оборудования')}
            >
              Открыть помощника
              <Icon name="chat" size={18} />
            </button>
          </section>
        </main>
      )}
      <footer className="site-container site-footer">
        <span>© Электрокомплект · HACKALEM AI</span>
        <span>Демо-интерфейс. Реальные условия — на ekt.kz.</span>
      </footer>
      {!isCart && <ChatWidget prompt={prompt} />}
    </>
  );
}

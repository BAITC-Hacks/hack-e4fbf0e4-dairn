import { useLocale } from '../../i18n/LocaleProvider';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { safeLink } from '../../api/client';
import { QuoteRows } from '../cart/QuoteRows';
import { ProductCard } from './ProductCard';
import { useAssistant } from './useAssistant';
interface ChatWidgetProps {
  prompt: { text: string; id: number };
}
export function ChatWidget({ prompt }: ChatWidgetProps) {
  const { t, dateLocale } = useLocale();
  const statuses: Record<string, string> = {
    queued: t('Запрос в очереди…'),
    waiting_for_attachments: t('Изучаем ваши файлы…'),
    processing: t('Ищем ответ…'),
    completed: t('Готово'),
    failed: t('Не удалось обработать запрос'),
  };
  const assistant = useAssistant();
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState('');
  const [seenPrompt, setSeenPrompt] = useState(prompt.id);
  if (seenPrompt !== prompt.id) {
    setSeenPrompt(prompt.id);
    setDraft(prompt.text);
    setOpen(true);
  }
  const input = useRef<HTMLTextAreaElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const cooledDown = assistant.now >= assistant.blockedUntil;
  const selectedFiles = assistant.files.filter((file) => file.selected);
  const locked =
    assistant.connecting ||
    assistant.busy ||
    !!assistant.pendingMessage ||
    !assistant.session ||
    !cooledDown;
  const canSend =
    !locked &&
    (!!draft.trim() || !!selectedFiles.length) &&
    !selectedFiles.some(
      (file) =>
        file.phase !== 'accepted' || file.attachment?.status === 'failed',
    );
  const cartLink = assistant.cart
    ? safeLink(assistant.cart.cart_url, 'cart')
    : null;
  useEffect(() => {
    if (open) input.current?.focus({ preventScroll: true });
  }, [open, prompt.id, assistant.connecting]);
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open) {
        setOpen(false);
        launcher.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [open]);
  useEffect(() => {
    if (open && transcript.current)
      transcript.current.scrollTop = assistant.messages.length
        ? transcript.current.scrollHeight
        : 0;
  }, [
    assistant.messages,
    assistant.selected,
    assistant.proposal,
    assistant.cart,
    open,
  ]);
  function close() {
    setOpen(false);
    launcher.current?.focus({ preventScroll: true });
  }
  async function send() {
    if (canSend && (await assistant.send(draft))) setDraft('');
  }
  return (
    <>
      <section
        className="chat-widget"
        role="dialog"
        aria-labelledby="assistant-title"
        hidden={!open}
      >
        <header className="chat-header">
          <span className="assistant-avatar">
            <Icon name="bolt" size={23} />
          </span>
          <div>
            <h2 id="assistant-title">{t('Помощник ЭКТ')}</h2>
            <p>
              <span className="connection-dot" />
              {assistant.connecting
                ? t('Подключаемся…')
                : assistant.session
                  ? t('Помогаем с выбором')
                  : t('Нет соединения')}
            </p>
          </div>
          <button
            className="icon-button"
            onClick={close}
            aria-label={t('Свернуть чат')}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="chat-toolbar">
          <span>{t('Консультант по электротехнике')}</span>
          <button
            onClick={assistant.reset}
            disabled={
              assistant.busy ||
              assistant.files.some((f) => f.phase === 'uploading')
            }
          >
            {t('Новый диалог')}
          </button>
        </div>
        {(assistant.session?.mode === 'demo' ||
          assistant.cart?.mode === 'demo') && (
          <div className="demo-banner">
            {t('Демо-режим · цены, остатки и корзина тестовые')}
          </div>
        )}
        {/* Keyboard users must be able to scroll the transcript independently. */}
        <div
          ref={transcript}
          className="conversation"
          role="region"
          tabIndex={0}
          aria-label={t('История диалога')}
        >
          {!assistant.messages.length && (
            <div className="welcome">
              <span className="welcome-icon">
                <Icon name="chat" size={28} />
              </span>
              <h3>{t('Здравствуйте! Чем помочь?')}</h3>
              <p>
                {t(
                  'Найдём товар, проверим характеристики и наличие или подберём альтернативу.',
                )}
              </p>
              <div className="quick-prompts">
                {[
                  t('Проверить DEMO-C16'),
                  t('Подобрать аналог DEMO-C16-OLD'),
                  t('Какие условия доставки?'),
                ].map((text) => (
                  <button
                    key={text}
                    onClick={() => {
                      setDraft(text);
                      input.current?.focus({ preventScroll: true });
                    }}
                    disabled={locked}
                  >
                    {text}
                    <Icon name="arrow" size={16} />
                  </button>
                ))}
              </div>
              <p className="welcome-tip">
                <Icon name="paperclip" size={16} />{' '}
                {t('Можно прикрепить фото или спецификацию')}
              </p>
            </div>
          )}
          {assistant.messages.map((message) => (
            <div className="exchange" key={message.message_id}>
              <div className="user-message">
                <span className="sr-only">{t('Вы:')} </span>
                {message.text || t('Проверьте прикреплённые файлы')}
                {message.attachment_ids.length > 0 && (
                  <small>
                    {t('Прикреплено файлов:')} {message.attachment_ids.length}
                  </small>
                )}
              </div>
              <div className="assistant-message">
                <span className="message-byline">
                  <Icon name="bolt" size={13} /> {t('ПОМОЩНИК ЭКТ')}
                </span>
                {message.answer && (
                  <p className="answer-text">{message.answer}</p>
                )}
                {!['completed', 'failed'].includes(message.status) && (
                  <p role="status" className="processing">
                    <span className="loading-dots" />
                    {statuses[message.status]}
                  </p>
                )}
                {message.status === 'failed' && (
                  <div className="error-box">
                    <strong>{t('Не удалось обработать запрос')}</strong>
                    <p>
                      {message.error?.message ||
                        t('Проверьте файлы и отправьте новый запрос.')}
                    </p>
                    <button
                      className="text-button"
                      onClick={() => setDraft(message.text)}
                    >
                      {t('Исправить и отправить заново')}
                    </button>
                  </div>
                )}
                {(message.warnings || []).map((warning, i) => (
                  <p className="warning" key={i}>
                    {warning}
                  </p>
                ))}
                {(message.products || []).map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    disabled={
                      locked ||
                      assistant.cartUnavailable ||
                      assistant.confirmationPending
                    }
                    onSelect={assistant.select}
                  />
                ))}
                {!!message.alternatives?.length && (
                  <h3 className="small-heading">{t('Возможные аналоги')}</h3>
                )}
                {(message.alternatives || []).map((alternative, i) => (
                  <div
                    className="alternative"
                    key={`${alternative.product.id}-${i}`}
                  >
                    <p>{alternative.reason}</p>
                    <p className="compatibility">
                      {alternative.compatibility === 'verified'
                        ? t('Совместимость подтверждена источником')
                        : t(
                            'Совместимость не подтверждена — требуется проверка специалиста',
                          )}
                    </p>
                    {!!alternative.differences?.length && (
                      <p>
                        {t('Отличия:')} {alternative.differences.join(', ')}
                      </p>
                    )}
                    <ProductCard
                      product={alternative.product}
                      disabled={
                        locked ||
                        assistant.cartUnavailable ||
                        assistant.confirmationPending
                      }
                      onSelect={assistant.select}
                    />
                  </div>
                ))}
                {!!message.sources?.length && (
                  <details className="sources">
                    <summary>
                      {t('Источники ответа (')}
                      {message.sources.length})
                    </summary>
                    <ul>
                      {message.sources.map((source, i) => (
                        <li key={i}>
                          {source.kind}: {source.reference}
                          {source.observed_at &&
                            ` · ${new Date(source.observed_at).toLocaleString(dateLocale)}`}
                          {source.version &&
                            t(' · версия {version}', {
                              version: source.version,
                            })}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </div>
          ))}
          {!!assistant.selected.length && (
            <section
              className="selection-panel"
              aria-label={t('Выбранные товары')}
            >
              <h3>
                {t('Ваш выбор ·')} {assistant.selected.length}
              </h3>
              <p>{t('Проверьте количество. Корзина пока не изменена.')}</p>
              {assistant.selected.map((item, index) => (
                <div
                  className="selection-row"
                  key={`${item.selection.product_id}-${item.selection.warehouse_id}`}
                >
                  <span>
                    <strong>{item.product.sku}</strong>
                    <small>
                      {item.selection.quantity} {item.product.unit} ·{' '}
                      {item.selection.warehouse_id}
                    </small>
                  </span>
                  <button
                    className="icon-button"
                    aria-label={t('Убрать {sku}', { sku: item.product.sku })}
                    disabled={assistant.busy || assistant.confirmationPending}
                    onClick={() => assistant.removeSelection(index)}
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>
              ))}
              {!assistant.confirmationPending && (
                <button
                  className="text-button"
                  disabled={locked}
                  onClick={() => void assistant.refreshProducts()}
                >
                  {t('Обновить товары и остатки')}
                </button>
              )}
              {!assistant.proposal && (
                <button
                  className="primary full-width"
                  disabled={locked || assistant.cartUnavailable}
                  onClick={() => void assistant.prepareProposal()}
                >
                  {t('Проверить предложение')} <Icon name="arrow" size={16} />
                </button>
              )}
            </section>
          )}
          {assistant.proposal && (
            <section
              className="proposal-panel"
              aria-label={t('Подтверждение добавления')}
            >
              <h3>{t('Проверьте перед добавлением')}</h3>
              <QuoteRows items={assistant.proposal.items} />
              <p>
                {t('Действует до {time}.', {
                  time: new Date(
                    assistant.proposal.expires_at,
                  ).toLocaleTimeString(dateLocale),
                })}
              </p>
              <p>{t('Только нажатие кнопки ниже изменит корзину.')}</p>
              {Date.parse(assistant.proposal.expires_at) <= assistant.now &&
              !assistant.confirmationPending ? (
                <>
                  <p className="warning">
                    {t('Предложение истекло. Получите новое.')}
                  </p>
                  <button
                    className="secondary full-width"
                    onClick={() => void assistant.prepareProposal()}
                    disabled={locked}
                  >
                    {t('Обновить предложение')}
                  </button>
                </>
              ) : (
                <button
                  className="primary full-width"
                  disabled={locked}
                  onClick={() => void assistant.confirm()}
                >
                  {assistant.busy
                    ? t('Проверяем…')
                    : assistant.confirmationPending
                      ? t('Повторить подтверждение')
                      : t('Добавить в корзину')}
                  <Icon name="cart" size={18} />
                </button>
              )}
              {!assistant.confirmationPending && (
                <button
                  className="text-button"
                  disabled={assistant.busy}
                  onClick={assistant.editProposal}
                >
                  {t('Изменить выбор')}
                </button>
              )}
              {assistant.confirmationPending && (
                <p className="warning">
                  {t(
                    'Результат подтверждения пока неизвестен. Повтор проверит тот же запрос без повторного добавления.',
                  )}
                </p>
              )}
            </section>
          )}
          {assistant.cart && (
            <section className="cart-success" role="status">
              <Icon name="check" />
              <strong>{t('Добавлено в демо-корзину')}</strong>
              <QuoteRows items={assistant.cart.items} />
              {cartLink ? (
                <a className="primary full-width" href={cartLink}>
                  {t('Открыть корзину')} <Icon name="arrow" size={16} />
                </a>
              ) : (
                <p className="warning">
                  {t(
                    'Ссылка корзины ведёт на другой сайт. Проверьте настройку адреса фронтенда.',
                  )}
                </p>
              )}
            </section>
          )}
        </div>
        {assistant.error && (
          <div className="error-box compact" role="alert">
            {assistant.error}
            {!cooledDown && (
              <span>
                {' '}
                {t('Повтор через {seconds} с.', {
                  seconds: Math.ceil(
                    (assistant.blockedUntil - assistant.now) / 1000,
                  ),
                })}
              </span>
            )}
            {!assistant.session && !assistant.connecting && (
              <button className="text-button" onClick={assistant.reset}>
                {t('Подключиться заново')}
              </button>
            )}
          </div>
        )}
        <div className="composer">
          {!!assistant.files.length && (
            <details
              className="files-panel"
              open={selectedFiles.length > 0 || undefined}
            >
              <summary>
                {t('Файлы: {selected} выбрано · {total} в диалоге', {
                  selected: selectedFiles.length,
                  total: assistant.files.length,
                })}
              </summary>
              <div className="files-scroll">
                {assistant.files.map((file) => (
                  <div className="file-row" key={file.key}>
                    <label>
                      <input
                        type="checkbox"
                        checked={file.selected}
                        disabled={
                          locked ||
                          file.phase === 'failed' ||
                          file.attachment?.status === 'failed'
                        }
                        onChange={() => assistant.toggleFile(file.key)}
                      />
                      <span>
                        {file.filename}
                        <small>
                          {file.phase === 'uploading'
                            ? t('Загрузка: {progress}%', {
                                progress: file.progress,
                              })
                            : file.phase === 'failed'
                              ? file.error
                              : (
                                  {
                                    queued: t('В очереди на обработку'),
                                    processing: t('Извлекаем содержимое…'),
                                    ready: t(
                                      'Готов · можно использовать повторно',
                                    ),
                                    failed: t('Ошибка обработки'),
                                  } as Record<string, string>
                                )[file.attachment!.status]}
                        </small>
                        {file.phase === 'uploading' && (
                          <progress
                            aria-label={t('Загрузка {filename}', {
                              filename: file.filename,
                            })}
                            value={file.progress}
                            max={100}
                          />
                        )}
                      </span>
                    </label>
                    <button
                      className="icon-button"
                      aria-label={t('Удалить {filename}', {
                        filename: file.filename,
                      })}
                      disabled={locked || file.phase === 'uploading'}
                      onClick={() => assistant.removeFile(file.key)}
                    >
                      <Icon name="close" size={14} />
                    </button>
                    {file.attachment?.error && (
                      <p className="warning">{file.attachment.error.message}</p>
                    )}
                    {file.attachment?.warnings.map((warning, i) => (
                      <p className="warning" key={i}>
                        {warning}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            </details>
          )}
          {assistant.pendingMessage && !assistant.busy && (
            <div className="pending-retry">
              <span>{t('Доставка сообщения не подтверждена.')}</span>
              <button
                className="secondary"
                disabled={!cooledDown}
                onClick={() =>
                  void assistant.send('', true).then((ok) => {
                    if (ok) setDraft('');
                  })
                }
              >
                {t('Повторить отправку')}
              </button>
            </div>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label htmlFor="chat-message" className="sr-only">
              {t('Ваше сообщение')}
            </label>
            <textarea
              id="chat-message"
              ref={input}
              placeholder={t('Артикул или ваш вопрос…')}
              rows={2}
              value={draft}
              maxLength={16000}
              disabled={locked}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div className="composer-bottom">
              <label
                className={`attachment-button ${locked ? 'disabled' : ''}`}
                title={t('Добавить файл')}
              >
                <Icon name="paperclip" />
                <span>{t('Файл')}</span>
                <input
                  type="file"
                  aria-label={t('Прикрепить файлы')}
                  multiple
                  accept=".xlsx,.xls,.docx,.doc,.pdf,.jpg,.jpeg,.png"
                  disabled={locked}
                  onChange={(event) => {
                    assistant.addFiles(Array.from(event.target.files || []));
                    event.target.value = '';
                  }}
                />
              </label>
              <span className="file-hint">{t('до 10 МиБ / файл')}</span>
              <button
                className="send-button"
                type="submit"
                aria-label={t('Отправить сообщение')}
                disabled={!canSend}
              >
                <Icon name="send" size={19} />
              </button>
            </div>
          </form>
          <p className="privacy-note">
            {t('Не отправляйте платёжные и личные данные.')}
          </p>
        </div>
      </section>
      <button
        ref={launcher}
        className={`chat-launcher ${open ? 'is-open' : ''}`}
        aria-label={open ? t('Свернуть помощника') : t('Открыть помощника')}
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Icon name={open ? 'close' : 'chat'} size={23} />
        {!open && <span>{t('Помощник ЭКТ')}</span>}
      </button>
    </>
  );
}

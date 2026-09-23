import { useState } from 'react';
import { useLocale } from '../../i18n/LocaleProvider';
import type { useAssistant } from './useAssistant';

type Assistant = ReturnType<typeof useAssistant>;
export function ConversationList({ assistant }: { assistant: Assistant }) {
  const { t, dateLocale } = useLocale();
  const [deleting, setDeleting] = useState<string | null>(null);
  const locked =
    assistant.busy ||
    assistant.connecting ||
    assistant.historyBusy ||
    assistant.confirmationPending ||
    assistant.files.some((file) => file.phase === 'uploading');
  return (
    <details className="conversation-list">
      <summary>{t('Мои диалоги')}</summary>
      <p className="history-caption">
        {t(
          'История хранится 30 дней по умолчанию. Файлы доступны до 24 часов.',
        )}
      </p>
      <ul>
        {assistant.conversations.map((conversation) => (
          <li key={conversation.session_id}>
            <button
              className="text-button"
              aria-label={t('Открыть диалог {id}', {
                id: conversation.session_id,
              })}
              aria-current={
                conversation.session_id === assistant.session?.session_id
                  ? 'true'
                  : undefined
              }
              disabled={locked}
              onClick={() => {
                setDeleting(null);
                assistant.chooseConversation(conversation);
              }}
            >
              <strong>
                {t('Диалог')} · {conversation.session_id.slice(-8)}
              </strong>
              <small>
                {new Date(conversation.created_at).toLocaleString(dateLocale)}
              </small>
            </button>
            <button
              className="text-button"
              aria-label={t('Удалить диалог {id}', {
                id: conversation.session_id,
              })}
              disabled={locked}
              onClick={() => setDeleting(conversation.session_id)}
            >
              {t('Удалить')}
            </button>
          </li>
        ))}
      </ul>
      {!assistant.conversations.length && (
        <p>{t('Сохранённых диалогов пока нет.')}</p>
      )}
      {assistant.moreConversations && (
        <button
          className="secondary"
          disabled={locked}
          onClick={() => void assistant.loadMoreConversations()}
        >
          {t('Загрузить ещё диалоги')}
        </button>
      )}
      {deleting && (
        <section
          className="delete-confirmation"
          aria-label={t('Подтверждение удаления диалога')}
        >
          <p>
            {t(
              'Удалить диалог {id} навсегда? Сообщения и файлы будут удалены. Это не отменяет уже выполненные операции с корзиной.',
              { id: deleting },
            )}
          </p>
          <button
            className="secondary"
            disabled={locked}
            onClick={() =>
              void assistant.deleteConversation(deleting).then((deleted) => {
                if (deleted) setDeleting(null);
              })
            }
          >
            {t('Удалить навсегда')}
          </button>
          <button
            className="text-button"
            disabled={locked}
            onClick={() => setDeleting(null)}
          >
            {t('Отмена')}
          </button>
        </section>
      )}
    </details>
  );
}

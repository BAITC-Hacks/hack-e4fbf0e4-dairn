import { useEffect, useId, useRef, useState } from 'react';
import { useLocale } from '../../i18n/LocaleProvider';
import { useAuth } from './AuthProvider';
import './AccountPanel.css';

export function AccountPanel() {
  const { t } = useLocale();
  const auth = useAuth();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [now, setNow] = useState(Date.now);
  const usernameInput = useRef<HTMLInputElement>(null);
  const toggleButton = useRef<HTMLButtonElement>(null);
  const waiting = Math.max(0, Math.ceil((auth.blockedUntil - now) / 1000));

  useEffect(() => {
    if (open) usernameInput.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!auth.blockedUntil) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= auth.blockedUntil) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [auth.blockedUntil]);

  function close() {
    setOpen(false);
    setPassword('');
    auth.clearError();
    toggleButton.current?.focus();
  }

  async function submit() {
    const succeeded = await (mode === 'login'
      ? auth.login({ username, password })
      : auth.register({ username, password, display_name: displayName }));
    setPassword('');
    if (succeeded) setOpen(false);
  }

  return (
    <section className="account-panel" aria-label={t('Управление аккаунтом')}>
      {auth.user ? (
        <div className="account-summary">
          <strong>
            {t('Вы вошли как {name}', { name: auth.user.display_name })}
          </strong>
          <button
            className="text-button"
            type="button"
            disabled={auth.busy}
            onClick={() => void auth.logout()}
          >
            {auth.busy ? t('Выходим…') : t('Выйти')}
          </button>
        </div>
      ) : (
        <>
          <button
            className="text-button account-toggle"
            type="button"
            ref={toggleButton}
            aria-expanded={open}
            aria-controls={`${id}-form`}
            onClick={() => (open ? close() : setOpen(true))}
          >
            {open ? t('Скрыть форму входа') : t('Войти в аккаунт')}
          </button>
          {open && (
            <div id={`${id}-form`}>
              <div
                className="account-modes"
                role="group"
                aria-label={t('Управление аккаунтом')}
              >
                <button
                  type="button"
                  aria-pressed={mode === 'login'}
                  disabled={auth.busy}
                  onClick={() => {
                    setMode('login');
                    setPassword('');
                    auth.clearError();
                  }}
                >
                  {t('Вход')}
                </button>
                <button
                  type="button"
                  aria-pressed={mode === 'register'}
                  disabled={auth.busy}
                  onClick={() => {
                    setMode('register');
                    setPassword('');
                    auth.clearError();
                  }}
                >
                  {t('Регистрация')}
                </button>
              </div>
              <form
                aria-label={
                  mode === 'login'
                    ? t('Вход в аккаунт')
                    : t('Регистрация аккаунта')
                }
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <label htmlFor={`${id}-username`}>
                  {t('Имя пользователя')}
                </label>
                <input
                  ref={usernameInput}
                  id={`${id}-username`}
                  name="username"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  value={username}
                  disabled={auth.busy}
                  onChange={(event) => setUsername(event.target.value)}
                  aria-describedby={`${id}-username-help`}
                />
                <p id={`${id}-username-help`} className="account-hint">
                  {t('3–64 символа: латинские буквы, цифры, _, . или -')}
                </p>
                {mode === 'register' && (
                  <>
                    <label htmlFor={`${id}-display-name`}>
                      {t('Отображаемое имя')}
                    </label>
                    <input
                      id={`${id}-display-name`}
                      name="display_name"
                      autoComplete="nickname"
                      required
                      value={displayName}
                      disabled={auth.busy}
                      onChange={(event) => setDisplayName(event.target.value)}
                    />
                  </>
                )}
                <label htmlFor={`${id}-password`}>{t('Пароль')}</label>
                <input
                  id={`${id}-password`}
                  name="password"
                  type="password"
                  autoComplete={
                    mode === 'login' ? 'current-password' : 'new-password'
                  }
                  required
                  value={password}
                  disabled={auth.busy}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-describedby={`${id}-password-help`}
                />
                <p id={`${id}-password-help`} className="account-hint">
                  {t('12–128 символов. Пробелы в пароле сохраняются.')}
                </p>
                <button
                  className="primary full-width"
                  type="submit"
                  disabled={auth.busy || waiting > 0}
                >
                  {auth.busy
                    ? t('Проверяем аккаунт…')
                    : mode === 'login'
                      ? t('Войти')
                      : t('Создать аккаунт')}
                </button>
              </form>
              <p className="account-note">
                {t(
                  'Гостевой диалог не переносится в аккаунт. Это отдельный аккаунт помощника, а не аккаунт сайта ЭКТ.',
                )}
              </p>
            </div>
          )}
        </>
      )}
      <p className="account-note">
        {t(
          'Диалоги аккаунта сохраняются на сервере. После перезагрузки страницы войдите снова.',
        )}
      </p>
      {auth.error && (
        <div className="error-box" role="alert">
          <p>{t(auth.error.key)}</p>
          {auth.error.detail && <p>{auth.error.detail}</p>}
        </div>
      )}
      {waiting > 0 && (
        <p className="account-note" role="status">
          {t('Вход временно недоступен. Повтор через {seconds} с.', {
            seconds: waiting,
          })}
        </p>
      )}
    </section>
  );
}

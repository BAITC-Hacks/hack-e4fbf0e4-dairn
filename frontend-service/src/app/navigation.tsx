import { useSyncExternalStore, type ComponentProps } from 'react';

function subscribe(callback: () => void) {
  window.addEventListener('popstate', callback);
  return () => window.removeEventListener('popstate', callback);
}
export function useLocation() {
  return useSyncExternalStore(
    subscribe,
    () => window.location.pathname + window.location.search,
  );
}
/** Same-origin navigation preserves memory-only account credentials. */
export function AppLink({
  href,
  onClick,
  children,
  ...props
}: ComponentProps<'a'>) {
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          props.target ||
          !href
        )
          return;
        const url = new URL(href, window.location.origin);
        if (url.origin !== window.location.origin) return;
        event.preventDefault();
        window.history.pushState(
          null,
          '',
          url.pathname + url.search + url.hash,
        );
        window.dispatchEvent(new PopStateEvent('popstate'));
        if (url.hash)
          document.getElementById(url.hash.slice(1))?.scrollIntoView();
        else window.scrollTo(0, 0);
      }}
    >
      {children}
    </a>
  );
}

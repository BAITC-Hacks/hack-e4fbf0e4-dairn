interface IconProps {
  name:
    | 'chat'
    | 'close'
    | 'send'
    | 'paperclip'
    | 'cart'
    | 'search'
    | 'arrow'
    | 'bolt'
    | 'check'
    | 'menu';
  size?: number;
}
const paths = {
  chat: 'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z',
  close: 'm6 6 12 12M6 18 18 6',
  send: 'm22 2-7 20-4-9-9-4 20-7ZM22 2 11 13',
  paperclip:
    'm21 11-8 8a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8L16 5',
  cart: 'M3 3h2l3 12h10l3-9H6M9 20h.01M18 20h.01',
  search: 'm21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  bolt: 'm13 2-9 12h7l-1 8L21 9h-8l1-7Z',
  check: 'm5 12 4 4L19 6',
  menu: 'M4 6h16M4 12h16M4 18h16',
};
export function Icon({ name, size = 20 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  ApiError,
  errorText,
  forgetSession,
  readSession,
  request,
  saveSession,
  sessionPath,
  uploadFile,
} from '../../api/client';
import type {
  Attachment,
  Cart,
  CartCommit,
  Message,
  MessageBody,
  Product,
  Proposal,
  Selection,
  Session,
} from '../../api/types';

export interface FileItem {
  key: string;
  filename: string;
  progress: number;
  phase: 'uploading' | 'accepted' | 'failed';
  attachment?: Attachment;
  error?: string;
  selected: boolean;
}
export interface SelectedItem {
  product: Product;
  selection: Selection;
}
const terminal = (m: Message) =>
  m.status === 'completed' || m.status === 'failed';
export function useAssistant() {
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selected, setSelected] = useState<SelectedItem[]>([]);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [pendingMessage, setPendingMessage] = useState<MessageBody | null>(
    null,
  );
  const [cartUnavailable, setCartUnavailable] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [blockedUntil, setBlockedUntil] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const controller = useRef(new AbortController());
  const state = useRef({ session, messages, files, blockedUntil });
  const lock = useRef(false);
  const confirmation = useRef<{ key: string; proposal: Proposal } | null>(null);
  const queue = useRef<{ key: string; file: File }[]>([]);
  const uploads = useRef(0);
  const uploadedCount = useRef(0);
  useEffect(() => {
    state.current = { session, messages, files, blockedUntil };
  });

  function fail(cause: unknown) {
    if (cause instanceof DOMException && cause.name === 'AbortError') return;
    setError(errorText(cause));
    if (cause instanceof ApiError) {
      if (cause.status === 429) {
        state.current.blockedUntil = Date.now() + cause.retryAfter;
        setBlockedUntil(state.current.blockedUntil);
      }
      if (cause.detail.code === 'cart_not_configured') setCartUnavailable(true);
      if (cause.status === 401 || cause.status === 403) {
        controller.current.abort();
        forgetSession();
        state.current.session = null;
        setBusy(false);
        setConnecting(false);
        lock.current = false;
        setSession(null);
        setMessages([]);
        setFiles([]);
        setSelected([]);
        setProposal(null);
        setCart(null);
        setPendingMessage(null);
        confirmation.current = null;
      }
    }
  }
  const pumpOnTick = useEffectEvent(() => {
    void pumpUploads();
  });
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    let interval: ReturnType<typeof setTimeout>;
    async function start() {
      try {
        const active =
          readSession() ||
          (await request<Session>('/v1/sessions', null, abort.signal, {
            locale: 'ru',
          }));
        if (abort.signal.aborted) return;
        saveSession(active);
        setSession(active);
        state.current.session = active;
        const history = await request<Message[]>(
          `${sessionPath(active)}/messages?limit=50`,
          active,
          abort.signal,
        );
        if (abort.signal.aborted) return;
        setMessages(history);
        state.current.messages = history;
        const ids = [...new Set(history.flatMap((m) => m.attachment_ids))];
        uploadedCount.current = ids.length;
        const restored: FileItem[] = [];
        for (const id of ids) {
          try {
            const attachment = await request<Attachment>(
              `${sessionPath(active)}/attachments/${encodeURIComponent(id)}`,
              active,
              abort.signal,
            );
            restored.push({
              key: id,
              filename: attachment.filename,
              progress: 100,
              phase: 'accepted',
              attachment,
              selected: false,
            });
          } catch (cause) {
            if (
              cause instanceof ApiError &&
              [401, 403, 429].includes(cause.status)
            )
              throw cause;
          }
        }
        if (!abort.signal.aborted) {
          setFiles(restored);
          state.current.files = restored;
        }
      } catch (cause) {
        if (!abort.signal.aborted) fail(cause);
      } finally {
        if (!abort.signal.aborted) setConnecting(false);
      }
    }
    async function poll() {
      const current = state.current;
      setNow(Date.now());
      if (
        current.session &&
        !abort.signal.aborted &&
        Date.now() >= current.blockedUntil
      ) {
        try {
          if (Date.parse(current.session.expires_at) <= Date.now())
            throw new ApiError(401, {
              code: 'session_expired',
              message: 'Session expired',
            });
          for (const message of current.messages.filter((m) => !terminal(m))) {
            const updated = await request<Message>(
              `${sessionPath(current.session)}/messages/${encodeURIComponent(message.message_id)}`,
              current.session,
              abort.signal,
            );
            if (!abort.signal.aborted)
              setMessages((items) =>
                items.map((m) =>
                  m.message_id === updated.message_id ? updated : m,
                ),
              );
          }
          for (const file of current.files.filter(
            (f) =>
              f.attachment &&
              ['queued', 'processing'].includes(f.attachment.status),
          )) {
            const attachment = await request<Attachment>(
              `${sessionPath(current.session)}/attachments/${encodeURIComponent(file.attachment!.attachment_id)}`,
              current.session,
              abort.signal,
            );
            if (!abort.signal.aborted)
              setFiles((items) =>
                items.map((f) =>
                  f.key === file.key ? { ...f, attachment } : f,
                ),
              );
          }
        } catch (cause) {
          if (!abort.signal.aborted) fail(cause);
        }
      }
      if (!abort.signal.aborted) {
        pumpOnTick();
        interval = setTimeout(poll, 1000);
      }
    }
    void start().then(() => {
      if (!abort.signal.aborted) interval = setTimeout(poll, 1000);
    });
    return () => {
      abort.abort();
      clearTimeout(interval);
    };
    // This effect owns a session's lifetime. Other state is read through state.current.
  }, [epoch]);

  function reset() {
    controller.current.abort();
    forgetSession();
    queue.current = [];
    uploads.current = 0;
    uploadedCount.current = 0;
    lock.current = false;
    confirmation.current = null;
    state.current = { session: null, messages: [], files: [], blockedUntil: 0 };
    setSession(null);
    setMessages([]);
    setFiles([]);
    setSelected([]);
    setProposal(null);
    setCart(null);
    setError('');
    setBusy(false);
    setPendingMessage(null);
    setCartUnavailable(false);
    setBlockedUntil(0);
    setConnecting(true);
    setEpoch((value) => value + 1);
  }
  async function pumpUploads() {
    const active = state.current.session;
    const abort = controller.current;
    if (!active || abort.signal.aborted) return;
    while (
      uploads.current < 2 &&
      queue.current.length &&
      Date.now() >= state.current.blockedUntil
    ) {
      const item = queue.current.shift()!;
      uploads.current++;
      void uploadFile(item.file, active, abort.signal, (progress) => {
        if (!abort.signal.aborted)
          setFiles((items) =>
            items.map((f) => (f.key === item.key ? { ...f, progress } : f)),
          );
      })
        .then((attachment) => {
          if (!abort.signal.aborted)
            setFiles((items) =>
              items.map((f) =>
                f.key === item.key
                  ? { ...f, phase: 'accepted', progress: 100, attachment }
                  : f,
              ),
            );
        })
        .catch((cause: unknown) => {
          if (!abort.signal.aborted) {
            setFiles((items) =>
              items.map((f) =>
                f.key === item.key
                  ? { ...f, phase: 'failed', error: errorText(cause) }
                  : f,
              ),
            );
            fail(cause);
            // Upload POST has no idempotency key. Never silently retry it.
          }
        })
        .finally(() => {
          if (!abort.signal.aborted) {
            uploads.current--;
            void pumpUploads();
          }
        });
    }
  }
  function addFiles(input: File[]) {
    if (!session || busy) return;
    const accepted: FileItem[] = [];
    let count = files.filter((f) => f.selected).length;
    for (const file of input) {
      if (
        !/\.(xlsx?|docx?|pdf|jpe?g|png)$/i.test(file.name) ||
        !file.size ||
        file.size > 10 * 1024 * 1024
      ) {
        setError(
          'Поддерживаются Excel, Word, PDF, JPEG и PNG до 10 МиБ. Пустые файлы не принимаются.',
        );
        continue;
      }
      if (count >= 10 || uploadedCount.current >= 20) {
        setError('Лимит: 10 файлов в сообщении и 20 в сессии.');
        break;
      }
      const key = crypto.randomUUID();
      count++;
      uploadedCount.current++;
      accepted.push({
        key,
        filename: file.name,
        phase: 'uploading',
        progress: 0,
        selected: true,
      });
      queue.current.push({ key, file });
    }
    setFiles((items) => [...items, ...accepted]);
    void pumpUploads();
  }
  function toggleFile(key: string) {
    if (busy || pendingMessage) return;
    setFiles((items) =>
      items.map((f) =>
        f.key === key &&
        (!f.selected ? items.filter((item) => item.selected).length < 10 : true)
          ? { ...f, selected: !f.selected }
          : f,
      ),
    );
  }
  function removeFile(key: string) {
    if (!busy && !pendingMessage)
      setFiles((items) => items.filter((f) => f.key !== key));
  }
  async function send(text: string, retry = false) {
    if (!session || lock.current || Date.now() < blockedUntil) return false;
    const chosen = files.filter((f) => f.selected);
    if (
      !retry &&
      ((!text.trim() && !chosen.length) ||
        text.length > 16000 ||
        chosen.some(
          (f) => f.phase !== 'accepted' || f.attachment?.status === 'failed',
        ))
    )
      return false;
    const body = retry
      ? pendingMessage
      : {
          client_message_id: crypto.randomUUID(),
          text: text.trim(),
          attachment_ids: chosen.map((f) => f.attachment!.attachment_id),
        };
    if (!body) return false;
    lock.current = true;
    setBusy(true);
    setError('');
    setPendingMessage(body);
    const abort = controller.current;
    try {
      const message = await request<Message>(
        `${sessionPath(session)}/messages`,
        session,
        abort.signal,
        body,
      );
      if (abort.signal.aborted) return false;
      setMessages((items) => [
        ...items.filter(
          (m) => m.client_message_id !== message.client_message_id,
        ),
        message,
      ]);
      setFiles((items) => items.map((f) => ({ ...f, selected: false })));
      setPendingMessage(null);
      return true;
    } catch (cause) {
      if (!abort.signal.aborted) {
        fail(cause);
        if (
          cause instanceof ApiError &&
          cause.status < 500 &&
          cause.status !== 429
        )
          setPendingMessage(null);
      }
      return false;
    } finally {
      if (!abort.signal.aborted) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  function select(product: Product, selection: Selection) {
    if (busy || confirmation.current) return;
    setProposal(null);
    setError('');
    // One row per product/warehouse; changing the quantity updates the row instead of duplicating it.
    setSelected((items) => [
      ...items.filter(
        (item) =>
          !(
            item.selection.product_id === selection.product_id &&
            item.selection.warehouse_id === selection.warehouse_id
          ),
      ),
      { product, selection },
    ]);
  }
  function removeSelection(index: number) {
    if (!busy && !confirmation.current) {
      setSelected((items) => items.filter((_, i) => i !== index));
      setProposal(null);
    }
  }
  async function prepareProposal() {
    if (
      !session ||
      !selected.length ||
      lock.current ||
      Date.now() < blockedUntil ||
      confirmation.current
    )
      return;
    lock.current = true;
    setBusy(true);
    setError('');
    setProposal(null);
    const abort = controller.current;
    try {
      const result = await request<Proposal>(
        `${sessionPath(session)}/cart/proposals`,
        session,
        abort.signal,
        { items: selected.map((item) => item.selection) },
      );
      if (!abort.signal.aborted) setProposal(result);
    } catch (cause) {
      if (!abort.signal.aborted) fail(cause);
    } finally {
      if (!abort.signal.aborted) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  async function confirm() {
    if (!session || !proposal || lock.current || Date.now() < blockedUntil)
      return;
    if (
      !confirmation.current &&
      Date.parse(proposal.expires_at) <= Date.now()
    ) {
      setProposal(null);
      setError('Предложение истекло. Запросите новое и проверьте его.');
      return;
    }
    confirmation.current ||= { key: crypto.randomUUID(), proposal };
    const attempt = confirmation.current;
    const abort = controller.current;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await request<CartCommit>(
        `${sessionPath(session)}/cart/proposals/${encodeURIComponent(attempt.proposal.proposal_id)}/confirm`,
        session,
        abort.signal,
        {
          proposal_version: attempt.proposal.version,
          confirmation_token: attempt.proposal.confirmation_token,
          confirmed: true,
        },
        { 'Idempotency-Key': attempt.key },
      );
      if (!abort.signal.aborted) {
        setCart(result.cart);
        setProposal(null);
        setSelected([]);
        confirmation.current = null;
      }
    } catch (cause) {
      if (!abort.signal.aborted) {
        fail(cause);
        if (
          cause instanceof ApiError &&
          cause.status < 500 &&
          cause.status !== 429
        ) {
          setProposal(null);
          confirmation.current = null;
        }
      }
    } finally {
      if (!abort.signal.aborted) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  function editProposal() {
    if (!busy && !confirmation.current) setProposal(null);
  }
  return {
    session,
    messages,
    files,
    selected,
    proposal,
    cart,
    error,
    busy,
    connecting,
    pendingMessage,
    cartUnavailable,
    now,
    blockedUntil,
    confirmationPending: confirmation.current !== null,
    reset,
    addFiles,
    toggleFile,
    removeFile,
    send,
    select,
    removeSelection,
    prepareProposal,
    refreshProducts: async () => {
      if (confirmation.current || busy) return;
      const query = selected.map((item) => item.product.sku).join(' ');
      setProposal(null);
      if (await send(query || 'Обновите наличие товаров')) setSelected([]);
    },
    confirm,
    editProposal,
  };
}

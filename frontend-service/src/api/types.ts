export interface Session {
  session_id: string;
  session_token: string;
  expires_at: string;
  locale: string;
  mode: string;
}
export interface ApiErrorBody {
  code: string;
  message: string;
  retryable?: boolean;
  request_id?: string;
}
export interface Price {
  amount: string;
  currency: string;
}
export interface Product {
  id: string;
  sku: string;
  name: string;
  category?: string;
  attributes?: Record<string, string | number | boolean | null>;
  certificates?: { name?: string; url: string }[];
  price: Price | null;
  unit: string;
  quantity_step: string;
  minimum_quantity: string;
  stock: { warehouse_id: string; available_quantity: string | null }[];
  availability?: string;
  observed_at?: string;
  source?: string;
  stale?: boolean;
}
export interface Alternative {
  product: Product;
  reason: string;
  compatibility: string;
  matched_attributes?: string[];
  differences?: string[];
}
export interface Attachment {
  attachment_id: string;
  filename: string;
  media_type: string;
  status: 'queued' | 'processing' | 'ready' | 'failed';
  expires_at: string;
  warnings: string[];
  blocks_count: number;
  error?: ApiErrorBody | null;
}
export interface MessageBody {
  client_message_id: string;
  text: string;
  attachment_ids: string[];
}
export interface Message extends MessageBody {
  message_id: string;
  status:
    | 'queued'
    | 'waiting_for_attachments'
    | 'processing'
    | 'completed'
    | 'failed';
  answer: string | null;
  products: Product[];
  alternatives: Alternative[];
  sources: {
    kind: string;
    reference: string;
    observed_at?: string;
    version?: string;
  }[];
  warnings: string[];
  error: ApiErrorBody | null;
  answer_mode: string | null;
  created_at: string;
  status_url: string;
  events_url: string;
}
export interface Selection {
  product_id: string;
  warehouse_id: string;
  quantity: string;
}
export interface Quote {
  selection: Selection;
  sku: string;
  name: string;
  unit: string;
  price: Price;
}
export interface Proposal {
  proposal_id: string;
  version: number;
  items: Quote[];
  expires_at: string;
  confirmation_token: string;
  status: string;
}
export interface Cart {
  cart_id: string;
  version: string;
  items: Quote[];
  cart_url: string;
  mode: 'demo';
}
export interface CartCommit {
  operation_id: string;
  proposal_id: string;
  status: 'committed';
  cart: Cart;
}

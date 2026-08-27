/**
 * 喜茶食安事件类型定义
 * Food Safety Event Types
 */

export type FoodSafetyEventSource = "sentiment" | "qiyu" | "regulatory" | "internal" | "manual" | "webhook";
export type EventStatus = "pending" | "processing" | "done" | "escalated" | "ignored";
export type EventIntent = "food_safety_risk" | "consultation_complaint" | "irrelevant";
export type SeverityLevel = "high" | "medium" | "low";
export type ReplyStatus = "pending" | "sent" | "reviewed" | "escalated";

export interface FoodSafetyInboxEvent {
  id: string;
  source: FoodSafetyEventSource;
  raw_content: string;
  parsed_content?: string;
  author?: string;
  platform?: string;
  received_at: string;
  processed_at?: string;
  status: EventStatus;

  // Classification
  intent?: EventIntent;
  intent_confidence?: number;
  intent_reason?: string;

  // Diagnosis
  severity?: SeverityLevel;
  root_cause?: string;
  risk_level?: number;

  // Reply
  reply_content?: string;
  reply_status?: ReplyStatus;
  reply_sent_at?: string;

  // Work order
  work_order_id?: string;
  case_no?: string;

  // Metadata
  metadata?: Record<string, unknown>;
  tags?: string[];
  assignee?: string;
  notes?: string;
}

export interface CreateInboxEventInput {
  source: FoodSafetyEventSource;
  raw_content: string;
  parsed_content?: string;
  author?: string;
  platform?: string;
  received_at?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

export interface InboxEventListParams {
  status?: EventStatus;
  source?: FoodSafetyEventSource;
  intent?: EventIntent;
  severity?: SeverityLevel;
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
}

export interface InboxStats {
  total: number;
  pending: number;
  processing: number;
  done: number;
  escalated: number;
  ignored: number;
  by_source: Record<FoodSafetyEventSource, number>;
  by_intent: Record<EventIntent, number>;
  by_severity: Record<SeverityLevel, number>;
}

// Database table name
export const FOOD_SAFETY_INBOX_TABLE = "fsf_food_safety_inbox";

// SQL to create the table (for reference)
export const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS fsf_food_safety_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source VARCHAR(50) NOT NULL,
  raw_content TEXT NOT NULL,
  parsed_content TEXT,
  author VARCHAR(255),
  platform VARCHAR(100),
  received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  processed_at TIMESTAMP WITH TIME ZONE,
  status VARCHAR(20) DEFAULT 'pending',

  intent VARCHAR(50),
  intent_confidence DECIMAL(3,2),
  intent_reason TEXT,

  severity VARCHAR(20),
  root_cause TEXT,
  risk_level INTEGER,

  reply_content TEXT,
  reply_status VARCHAR(20),
  reply_sent_at TIMESTAMP WITH TIME ZONE,

  work_order_id UUID,
  case_no VARCHAR(50),

  metadata JSONB,
  tags TEXT[],
  assignee VARCHAR(255),
  notes TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_fsf_inbox_status ON fsf_food_safety_inbox(status);
CREATE INDEX idx_fsf_inbox_source ON fsf_food_safety_inbox(source);
CREATE INDEX idx_fsf_inbox_intent ON fsf_food_safety_inbox(intent);
CREATE INDEX idx_fsf_inbox_severity ON fsf_food_safety_inbox(severity);
CREATE INDEX idx_fsf_inbox_received_at ON fsf_food_safety_inbox(received_at);
`;

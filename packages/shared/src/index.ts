// Shared TypeScript types between apps/api and apps/mobile
// Populated incrementally as features are built.

export type SiteStatus = 'up' | 'down' | 'unknown';
export type EventSeverity = 'info' | 'warning' | 'critical';
export type AlertSeverity = 'info' | 'warning' | 'critical';
export type UserRole = 'owner' | 'member';
export type OrgPlan = 'starter' | 'pro' | 'agency';
export type VitalsStrategy = 'mobile' | 'desktop';
export type AiInsightKind = 'brief' | 'review_draft' | 'report_narrative' | 'chat';

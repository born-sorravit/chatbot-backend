/** Admin notifications (master plan §40). */
export enum NotificationType {
  NewConversation = 'NEW_CONVERSATION',
  CustomerRequestedHuman = 'CUSTOMER_REQUESTED_HUMAN',
  AiHandoff = 'AI_HANDOFF',
  NewMessage = 'NEW_MESSAGE',
  ToolApprovalRequired = 'TOOL_APPROVAL_REQUIRED',
}

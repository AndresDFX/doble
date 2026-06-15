/**
 * Composition root.
 *
 * The one place that knows about concrete classes: it instantiates the
 * infrastructure adapters and injects them into the application use cases and
 * services. Everywhere else depends on interfaces. Controllers import this
 * singleton and call `container.<service>.<method>()`.
 */
import { pool } from "../db.js";
import { waStatus } from "../wa-status.js";
import {
  PostgresAgentStateRepository,
  PostgresChatRepository,
  PostgresDraftRepository,
  PostgresLabelRepository,
  PostgresMessageRepository,
  PostgresOwnerNoteRepository,
  PostgresRagReadModel,
} from "../infrastructure/repositories.js";
import { HttpAiService } from "../infrastructure/ai-service.js";
import { BaileysWhatsAppGateway } from "../infrastructure/whatsapp-gateway.js";
import {
  ActivityLogAdapter,
  appLogger,
  BusEventPublisher,
  SystemClock,
} from "../infrastructure/adapters.js";
import { ProcessIncomingMessage } from "../application/process-incoming-message.js";
import { RetryNeedInfo } from "../application/retry-need-info.js";
import type { ReplyDeliveryDeps } from "../application/reply-delivery.js";
import {
  AgentStateService,
  ChatService,
  DraftService,
  HealthService,
  LabelService,
  OwnerNoteService,
  RagService,
} from "../application/services.js";

// --- Infrastructure adapters ------------------------------------------------
const agentStateRepo = new PostgresAgentStateRepository();
const chatRepo = new PostgresChatRepository();
const messageRepo = new PostgresMessageRepository();
const draftRepo = new PostgresDraftRepository();
const labelRepo = new PostgresLabelRepository();
const ownerNoteRepo = new PostgresOwnerNoteRepository();
const ragReadModel = new PostgresRagReadModel();

const ai = new HttpAiService();
const whatsapp = new BaileysWhatsAppGateway();
const events = new BusEventPublisher();
const activityLog = new ActivityLogAdapter();
const clock = new SystemClock();
const logger = appLogger;

const deliveryDeps: ReplyDeliveryDeps = {
  whatsapp,
  messages: messageRepo,
  ai,
  events,
  clock,
  logger,
};

// --- Application use cases / services ---------------------------------------
const processIncomingMessage = new ProcessIncomingMessage({
  chats: chatRepo,
  messages: messageRepo,
  drafts: draftRepo,
  agentState: agentStateRepo,
  ai,
  whatsapp,
  events,
  activity: activityLog,
  clock,
  logger,
});

const retryNeedInfo = new RetryNeedInfo({
  drafts: draftRepo,
  messages: messageRepo,
  agentState: agentStateRepo,
  ai,
  whatsapp,
  events,
  activity: activityLog,
  clock,
  logger,
});

export const container = {
  ai,
  processIncomingMessage,
  retryNeedInfo,
  agentState: new AgentStateService(agentStateRepo),
  chats: new ChatService(chatRepo, messageRepo),
  drafts: new DraftService(draftRepo, chatRepo, deliveryDeps),
  labels: new LabelService(labelRepo),
  ownerNotes: new OwnerNoteService(
    ownerNoteRepo,
    chatRepo,
    ai,
    events,
    activityLog,
    clock,
    logger
  ),
  rag: new RagService(ragReadModel, ai),
  health: new HealthService(
    ai,
    () => pool.query("SELECT 1").then(() => true).catch(() => false),
    () => waStatus.get().connection,
    clock
  ),
};

export type Container = typeof container;

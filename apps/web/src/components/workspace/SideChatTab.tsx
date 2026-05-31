import { useT } from '../../i18n';
import { Icon } from '../Icon';
import { ChatPane } from '../ChatPane';
import type {
  AgentInfo,
  AppConfig,
  Conversation,
  ProjectFile,
} from '../../types';
import type { ChatSessionMode } from '@open-design/contracts';
import { useConversationChat } from './useConversationChat';
import styles from './SideChatTab.module.css';

interface Props {
  projectId: string;
  /** The conversation this side chat is bound to (the `chat:<id>` tab id). */
  conversationId: string;
  /** Live app config + agent map + locale, threaded from ProjectView so the
   *  side chat runs against the same agent selection as the primary chat. */
  config: AppConfig;
  agentsById: Map<string, AgentInfo>;
  locale: string;
  /** Project files for the composer's @-mention picker and produced-file chips. */
  projectFiles: ProjectFile[];
  projectFileNames?: Set<string>;
  /** Conversation list + selection callbacks, shared with the header menu so a
   *  side chat is just another conversation the user can browse/switch. */
  conversations: Conversation[];
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onRenameConversation?: (id: string, title: string) => void;
  onSessionModeChange?: (id: string, mode: ChatSessionMode) => void;
  onNewConversation?: () => void;
  /** Forward produced-file / tool-card open requests to the workspace. */
  onRequestOpenFile?: (name: string) => void;
}

// A ChatPane mounted as a workspace tab, bound to a single (usually
// context-seeded) conversation. Keyed by `${projectId}:${conversationId}` at
// the call site so switching the bound conversation fully resets composer and
// scroll state.
export function SideChatTab({
  projectId,
  conversationId,
  config,
  agentsById,
  locale,
  projectFiles,
  projectFileNames,
  conversations,
  onSelectConversation,
  onDeleteConversation,
  onRenameConversation,
  onSessionModeChange,
  onNewConversation,
  onRequestOpenFile,
}: Props) {
  const t = useT();
  const sessionMode =
    conversations.find((conversation) => conversation.id === conversationId)?.sessionMode
    ?? 'design';
  const chat = useConversationChat(projectId, conversationId, {
    config,
    agentsById,
    locale,
    sessionMode,
  });

  return (
    <div className={styles.sideChat} data-testid="side-chat-tab">
      <div className={styles.banner} data-testid="side-chat-context-banner">
        <span className={styles.bannerIcon} aria-hidden>
          <Icon name="comment" size={14} />
        </span>
        <span>{t('workspace.sideChatContextBanner')}</span>
      </div>
      <div className={styles.pane}>
        <ChatPane
          messages={chat.messages}
          streaming={chat.streaming}
          error={chat.error}
          projectId={projectId}
          sessionMode={sessionMode}
          onSessionModeChange={(mode) => onSessionModeChange?.(conversationId, mode)}
          projectFiles={projectFiles}
          projectFileNames={projectFileNames}
          onEnsureProject={async () => projectId}
          onSend={chat.onSend}
          onRetry={chat.onRetry}
          onStop={chat.onStop}
          onSubmitForm={(text) => chat.onSend(text, [], [])}
          onRequestOpenFile={onRequestOpenFile}
          conversations={conversations}
          activeConversationId={conversationId}
          onSelectConversation={onSelectConversation}
          onDeleteConversation={onDeleteConversation}
          onRenameConversation={onRenameConversation}
          onNewConversation={onNewConversation}
          researchAvailable={config.mode === 'daemon'}
        />
      </div>
    </div>
  );
}

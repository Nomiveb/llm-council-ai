"use client";

import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import HistoryPage from './components/HistoryPage';
import LogsPage from './components/LogsPage';
import { api } from './api';
import './App.css';

function App() {
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [modelConfig, setModelConfig] = useState(null);
  const [apiKeyConfig, setApiKeyConfig] = useState(null);
  const [theme, setTheme] = useState('light');
  const [view, setView] = useState(() =>
    typeof window !== 'undefined' && window.location.pathname === '/history'
      ? 'history'
      : typeof window !== 'undefined' && window.location.pathname === '/logs'
        ? 'logs'
        : 'chat'
  );

  // Load conversations on mount
  useEffect(() => {
    const savedTheme = window.localStorage.getItem('council-theme');
    const initialTheme =
      savedTheme ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setTheme(initialTheme);
    document.documentElement.dataset.theme = initialTheme;
    loadConversations();
    loadModelConfig();
    loadApiKeyConfig();
    const onPopState = () => {
      setView(
        window.location.pathname === '/history'
          ? 'history'
          : window.location.pathname === '/logs'
            ? 'logs'
            : 'chat'
      );
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const handleToggleTheme = () => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      window.localStorage.setItem('council-theme', next);
      return next;
    });
  };

  // Load conversation details when selected
  useEffect(() => {
    if (currentConversationId) {
      loadConversation(currentConversationId);
    }
  }, [currentConversationId]);

  const loadConversations = async () => {
    try {
      const convs = await api.listConversations();
      setConversations(convs);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  };

  const loadModelConfig = async () => {
    try {
      setModelConfig(await api.getModelConfig());
    } catch (error) {
      console.error('Failed to load model config:', error);
    }
  };

  const loadApiKeyConfig = async () => {
    try {
      setApiKeyConfig(await api.getApiKeyConfig());
    } catch (error) {
      console.error('Failed to load API key config:', error);
    }
  };

  const handleSaveModelConfig = async (nextConfig) => {
    const saved = await api.updateModelConfig(nextConfig);
    setModelConfig(saved);
    return saved;
  };

  const handleSaveApiKey = async (apiKey) => {
    const saved = await api.updateApiKeyConfig(apiKey);
    setApiKeyConfig(saved);
    return saved;
  };

  const loadConversation = async (id) => {
    try {
      const conv = await api.getConversation(id);
      setCurrentConversation(conv);
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  const handleNewConversation = async () => {
    setCurrentConversationId(null);
    setCurrentConversation({
      id: null,
      created_at: new Date().toISOString(),
      title: 'New Conversation',
      messages: [],
    });
    navigateTo('chat');
  };

  const handleSelectConversation = (id) => {
    setCurrentConversationId(id);
    navigateTo('chat');
  };

  const handleDeleteConversation = async (id) => {
    try {
      await api.deleteConversation(id);
      setConversations((prev) => prev.filter((conversation) => conversation.id !== id));
      if (currentConversationId === id) {
        setCurrentConversationId(null);
        setCurrentConversation(null);
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  };

  const handleBatchDelete = async (ids) => {
    if (!ids.length) return;
    await api.deleteConversations(ids);
    setConversations((prev) => prev.filter((conversation) => !ids.includes(conversation.id)));
    if (ids.includes(currentConversationId)) {
      setCurrentConversationId(null);
      setCurrentConversation(null);
    }
  };

  const navigateTo = (nextView) => {
    const path = nextView === 'history' ? '/history' : '/';
    const resolvedPath = nextView === 'logs' ? '/logs' : path;
    if (window.location.pathname !== resolvedPath) {
      window.history.pushState({}, '', resolvedPath);
    }
    setView(nextView);
  };

  const handleSendMessage = async (content) => {
    setIsLoading(true);
    let conversationId = currentConversationId;
    try {
      if (!conversationId) {
        const newConv = await api.createConversation();
        conversationId = newConv.id;
        setCurrentConversationId(newConv.id);
        setConversations((prev) => [
          {
            id: newConv.id,
            created_at: newConv.created_at,
            title: newConv.title,
            message_count: 0,
          },
          ...prev,
        ]);
        setCurrentConversation((prev) => ({
          ...(prev || newConv),
          id: newConv.id,
          created_at: newConv.created_at,
          title: newConv.title,
          messages: prev?.messages || [],
        }));
      }

      // Optimistically add user message to UI
      const userMessage = { role: 'user', content };
      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
      }));

      // Create a partial assistant message that will be updated progressively
      const assistantMessage = {
        role: 'assistant',
        stage1: null,
        stage2: null,
        stage3: null,
        metadata: null,
        currentStage: null,
        modelConfig,
        loading: {
          stage1: false,
          stage2: false,
          stage3: false,
        },
      };

      // Add the partial assistant message
      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, assistantMessage],
      }));

      // Send message with streaming
      await api.sendMessageStream(conversationId, content, (eventType, event) => {
        switch (eventType) {
          case 'stage1_start':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.currentStage = 'stage1';
              lastMsg.modelConfig = event.model_config || lastMsg.modelConfig;
              lastMsg.loading.stage1 = true;
              return { ...prev, messages };
            });
            break;

          case 'stage1_complete':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.stage1 = event.data;
              lastMsg.loading.stage1 = false;
              lastMsg.currentStage = 'stage1_complete';
              return { ...prev, messages };
            });
            break;

          case 'stage2_start':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.currentStage = 'stage2';
              lastMsg.modelConfig = event.model_config || lastMsg.modelConfig;
              lastMsg.loading.stage2 = true;
              return { ...prev, messages };
            });
            break;

          case 'stage2_complete':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.stage2 = event.data;
              lastMsg.metadata = event.metadata;
              lastMsg.loading.stage2 = false;
              lastMsg.currentStage = 'stage2_complete';
              return { ...prev, messages };
            });
            break;

          case 'stage3_start':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.currentStage = 'stage3';
              lastMsg.modelConfig = event.model_config || lastMsg.modelConfig;
              lastMsg.loading.stage3 = true;
              return { ...prev, messages };
            });
            break;

          case 'stage3_complete':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.stage3 = event.data;
              lastMsg.loading.stage3 = false;
              lastMsg.currentStage = 'complete';
              return { ...prev, messages };
            });
            break;

          case 'title_complete':
            // Reload conversations to get updated title
            loadConversations();
            break;

          case 'complete':
            // Stream complete, reload conversations list
            loadConversations();
            setIsLoading(false);
            break;

          case 'error':
            console.error('Stream error:', event.message);
            setIsLoading(false);
            break;

          default:
            console.log('Unknown event type:', eventType);
        }
      });
    } catch (error) {
      console.error('Failed to send message:', error);
      // Remove optimistic messages on error
      setCurrentConversation((prev) => ({
        ...prev,
        messages: prev.messages.slice(0, -2),
      }));
      setIsLoading(false);
    }
  };

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        onDeleteConversation={handleDeleteConversation}
        view={view}
        onNavigate={navigateTo}
        modelConfig={modelConfig}
        onSaveModelConfig={handleSaveModelConfig}
        apiKeyConfig={apiKeyConfig}
        onSaveApiKey={handleSaveApiKey}
        theme={theme}
        onToggleTheme={handleToggleTheme}
      />
      {view === 'history' ? (
        <HistoryPage
          conversations={conversations}
          onSelectConversation={handleSelectConversation}
          onDeleteSelected={handleBatchDelete}
          onRefresh={loadConversations}
        />
      ) : view === 'logs' ? (
        <LogsPage currentConversationId={currentConversationId} />
      ) : (
        <ChatInterface
          conversation={currentConversation}
          onSendMessage={handleSendMessage}
          isLoading={isLoading}
        />
      )}
    </div>
  );
}

export default App;

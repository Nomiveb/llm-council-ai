"use client";

import { useMemo, useState } from 'react';
import { api } from '../api';
import './Sidebar.css';

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  view,
  onNavigate,
  modelConfig,
  onSaveModelConfig,
  apiKeyConfig,
  onSaveApiKey,
  theme,
  onToggleTheme,
}) {
  const [query, setQuery] = useState('');
  const [isEditingModels, setIsEditingModels] = useState(false);
  const [draftCouncil, setDraftCouncil] = useState('');
  const [draftChairman, setDraftChairman] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [modelOptions, setModelOptions] = useState([]);
  const [modelFilter, setModelFilter] = useState('');
  const [modelStatus, setModelStatus] = useState('');
  const [isModelListOpen, setIsModelListOpen] = useState(false);
  const [draftApiKey, setDraftApiKey] = useState('');

  const filteredConversations = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((conversation) =>
      (conversation.title || 'New Conversation').toLowerCase().includes(q)
    );
  }, [conversations, query]);

  const councilModels = modelConfig?.council_models || [];

  const startEditingModels = () => {
    setDraftCouncil(councilModels.join('\n'));
    setDraftChairman(modelConfig?.chairman_model || '');
    setDraftTitle(modelConfig?.title_model || '');
    setDraftApiKey('');
    setModelStatus('');
    setIsEditingModels(true);
  };

  const saveModels = async () => {
    const council_models = draftCouncil
      .split('\n')
      .map((model) => model.trim())
      .filter(Boolean);
    try {
      await onSaveModelConfig({
        council_models,
        chairman_model: draftChairman.trim(),
        title_model: draftTitle.trim(),
      });
      setModelStatus('Saved');
      setIsEditingModels(false);
    } catch (error) {
      setModelStatus(error.message);
    }
  };

  const loadModelOptions = async () => {
    if (isModelListOpen && modelOptions.length > 0) {
      setIsModelListOpen(false);
      return;
    }
    setIsModelListOpen(true);
    setModelStatus('Loading OpenRouter models...');
    try {
      const payload = await api.listOpenRouterModels();
      setModelOptions(payload.models || []);
      setModelStatus(`Loaded ${payload.models?.length || 0} models`);
    } catch (error) {
      setModelStatus(error.message);
    }
  };

  const filteredOptions = useMemo(() => {
    const q = modelFilter.trim().toLowerCase();
    if (!q) return modelOptions;
    return modelOptions
      .filter((model) =>
        `${model.id} ${model.name}`.toLowerCase().includes(q)
      );
  }, [modelOptions, modelFilter]);

  const selectedDraftModels = useMemo(
    () =>
      draftCouncil
        .split('\n')
        .map((model) => model.trim())
        .filter(Boolean),
    [draftCouncil]
  );

  const toggleModelInCouncil = (modelId) => {
    const current = draftCouncil
      .split('\n')
      .map((model) => model.trim())
      .filter(Boolean);
    setDraftCouncil(
      current.includes(modelId)
        ? current.filter((model) => model !== modelId).join('\n')
        : [...current, modelId].join('\n')
    );
  };

  const saveApiKey = async () => {
    try {
      await onSaveApiKey(draftApiKey);
      setDraftApiKey('');
      setModelStatus('API key saved');
    } catch (error) {
      setModelStatus(error.message);
    }
  };

  return (
    <aside className="sidebar" aria-label="Conversation sidebar">
      <div className="sidebar-header">
        <div className="brand-row">
          <div className="brand-mark">C</div>
          <div>
            <h1>Council</h1>
            <p>Multi-model review</p>
          </div>
        </div>
        <button className="new-conversation-btn" onClick={onNewConversation}>
          <span aria-hidden="true">+</span>
          New conversation
        </button>
        <div className="sidebar-nav">
          <button
            className={view === 'chat' ? 'active' : ''}
            onClick={() => onNavigate('chat')}
          >
            Chat
          </button>
          <button
            className={view === 'history' ? 'active' : ''}
            onClick={() => onNavigate('history')}
          >
            History
          </button>
          <button
            className={view === 'logs' ? 'active' : ''}
            onClick={() => onNavigate('logs')}
          >
            Logs
          </button>
        </div>
        <button className="theme-toggle" onClick={onToggleTheme}>
          {theme === 'dark' ? 'Light theme' : 'Dark theme'}
        </button>
      </div>

      <div className="sidebar-search">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search conversations"
          aria-label="Search conversations"
        />
      </div>

      <div className="conversation-list">
        <div className="sidebar-section-label">Recent</div>
        {filteredConversations.length === 0 ? (
          <div className="no-conversations">
            {query ? 'No matching conversations' : 'No conversations yet'}
          </div>
        ) : (
          filteredConversations.map((conversation) => (
            <div
              key={conversation.id}
              className={`conversation-item-wrap ${
                conversation.id === currentConversationId ? 'active' : ''
              }`}
            >
              <button
                className="conversation-item"
                onClick={() => onSelectConversation(conversation.id)}
              >
                <span className="conversation-title">
                  {conversation.title || 'New Conversation'}
                </span>
                <span className="conversation-meta">
                  {conversation.message_count} messages
                  {formatDate(conversation.created_at)
                    ? ` · ${formatDate(conversation.created_at)}`
                    : ''}
                </span>
              </button>
              <button
                className="delete-conversation-btn"
                onClick={() => onDeleteConversation(conversation.id)}
                aria-label={`Delete ${conversation.title || 'New Conversation'}`}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>

      <div className="council-status">
        <div className="model-header-row">
          <div className="sidebar-section-label">Models</div>
          <button className="mini-btn" onClick={startEditingModels}>
            Edit
          </button>
        </div>
        <div className="model-group-label">Individual responses + peer review</div>
        {councilModels.map((model) => (
          <div className="model-status" key={model}>
            <span className="status-dot" />
            <span title={model}>{model}</span>
          </div>
        ))}
        <div className="model-group-label">Final answer</div>
        <div className="model-status">
          <span className="status-dot chairman" />
          <span title={modelConfig?.chairman_model}>
            {modelConfig?.chairman_model || 'Loading...'}
          </span>
        </div>
      </div>

      {isEditingModels && (
        <div className="model-editor-backdrop" role="presentation">
          <div className="model-editor" role="dialog" aria-modal="true">
            <div className="model-editor-header">
              <div>
                <h2>OpenRouter models</h2>
                <p>Use exact ids like anthropic/claude-opus-4.7-fast</p>
              </div>
              <button className="icon-btn" onClick={() => setIsEditingModels(false)}>
                ×
              </button>
            </div>

            <label className="editor-label">
              Individual responses + peer review
              <textarea
                value={draftCouncil}
                onChange={(event) => setDraftCouncil(event.target.value)}
                spellCheck="false"
                rows={6}
              />
            </label>

            <label className="editor-label">
              Final answer model
              <input
                value={draftChairman}
                onChange={(event) => setDraftChairman(event.target.value)}
                spellCheck="false"
              />
            </label>

            <label className="editor-label">
              Conversation title model
              <input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                spellCheck="false"
              />
            </label>

            <div className="api-key-panel">
              <div>
                <strong>OpenRouter API key</strong>
                <span>
                  {apiKeyConfig?.source === 'environment'
                    ? `Set by environment · ${apiKeyConfig.masked}`
                    : apiKeyConfig?.has_openrouter_api_key
                      ? `Saved on site · ${apiKeyConfig.masked}`
                      : 'Missing'}
                </span>
              </div>
              <div className="api-key-actions">
                <input
                  type="password"
                  value={draftApiKey}
                  onChange={(event) => setDraftApiKey(event.target.value)}
                  placeholder="sk-or-v1-..."
                />
                <button className="secondary-btn" onClick={saveApiKey}>
                  Save key
                </button>
              </div>
            </div>

            <div className="model-browser">
              <div className="model-browser-actions">
                <button className="secondary-btn" onClick={loadModelOptions}>
                  {isModelListOpen && modelOptions.length > 0
                    ? 'Hide OpenRouter list'
                    : 'Load OpenRouter list'}
                </button>
                {isModelListOpen && (
                  <input
                    value={modelFilter}
                    onChange={(event) => setModelFilter(event.target.value)}
                    placeholder="Filter models"
                  />
                )}
              </div>
              {modelStatus && <div className="model-status-text">{modelStatus}</div>}
              {isModelListOpen && filteredOptions.length > 0 && (
                <div className="model-options">
                  {filteredOptions.map((model) => (
                    <button
                      key={model.id}
                      className={selectedDraftModels.includes(model.id) ? 'selected' : ''}
                      onClick={() => toggleModelInCouncil(model.id)}
                      title={model.name}
                    >
                      <span>{model.id}</span>
                      {selectedDraftModels.includes(model.id) && <strong>✓</strong>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="model-editor-actions">
              <button className="secondary-btn" onClick={() => setIsEditingModels(false)}>
                Cancel
              </button>
              <button className="save-btn" onClick={saveModels}>
                Save models
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

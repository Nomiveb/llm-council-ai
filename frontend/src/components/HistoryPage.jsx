"use client";

import { useMemo, useState } from 'react';
import './HistoryPage.css';

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function HistoryPage({
  conversations,
  onSelectConversation,
  onDeleteSelected,
  onRefresh,
}) {
  const [selected, setSelected] = useState([]);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((conversation) =>
      (conversation.title || 'New Conversation').toLowerCase().includes(q)
    );
  }, [conversations, query]);

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((conversation) => selected.includes(conversation.id));

  const toggleOne = (id) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleVisible = () => {
    if (allVisibleSelected) {
      setSelected((prev) =>
        prev.filter((id) => !filtered.some((conversation) => conversation.id === id))
      );
    } else {
      setSelected((prev) => [
        ...prev,
        ...filtered
          .map((conversation) => conversation.id)
          .filter((id) => !prev.includes(id)),
      ]);
    }
  };

  const deleteSelected = async () => {
    await onDeleteSelected(selected);
    setSelected([]);
  };

  const deleteAll = async () => {
    await onDeleteSelected(conversations.map((conversation) => conversation.id));
    setSelected([]);
  };

  return (
    <main className="history-page">
      <header className="history-header">
        <div>
          <p>History</p>
          <h2>Conversations</h2>
        </div>
        <button className="history-secondary-btn" onClick={onRefresh}>
          Refresh
        </button>
      </header>

      <div className="history-toolbar">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search history"
        />
        <button className="history-secondary-btn" onClick={toggleVisible}>
          {allVisibleSelected ? 'Unselect visible' : 'Select visible'}
        </button>
        <button
          className="history-danger-btn"
          onClick={deleteSelected}
          disabled={selected.length === 0}
        >
          Delete selected
        </button>
        <button
          className="history-danger-btn"
          onClick={deleteAll}
          disabled={conversations.length === 0}
        >
          Delete all
        </button>
      </div>

      <div className="history-count">
        {filtered.length} conversations · {selected.length} selected
      </div>

      <div className="history-list">
        {filtered.map((conversation) => (
          <div className="history-row" key={conversation.id}>
            <input
              type="checkbox"
              checked={selected.includes(conversation.id)}
              onChange={() => toggleOne(conversation.id)}
              aria-label={`Select ${conversation.title || 'New Conversation'}`}
            />
            <button onClick={() => onSelectConversation(conversation.id)}>
              <span>{conversation.title || 'New Conversation'}</span>
              <small>
                {conversation.message_count} messages
                {formatDate(conversation.created_at)
                  ? ` · ${formatDate(conversation.created_at)}`
                  : ''}
              </small>
            </button>
          </div>
        ))}
        {filtered.length === 0 && <div className="history-empty">No conversations</div>}
      </div>
    </main>
  );
}

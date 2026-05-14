"use client";

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import CouncilResponse from './CouncilResponse';
import './ChatInterface.css';

const SUGGESTED_PROMPTS = [
  'Compare RAG vs fine-tuning for enterprise knowledge bases',
  'How should I evaluate LLM output quality at scale?',
  'What are the risks of relying on a single model for research?',
];

export default function ChatInterface({
  conversation,
  onSendMessage,
  isLoading,
}) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation, isLoading]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 190)}px`;
  }, [input]);

  const canSend = Boolean(input.trim()) && !isLoading && conversation;

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!canSend) return;
    onSendMessage(input);
    setInput('');
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit(event);
    }
  };

  const showEmpty = !conversation || conversation.messages.length === 0;

  return (
    <main className="chat-interface">
      <header className="mobile-topbar">
        <div className="brand-mark">C</div>
        <span>LLM Council</span>
      </header>

      <div className="messages-container">
        <div className="thread">
          {showEmpty ? (
            <div className="empty-state">
              <div className="empty-kicker">Council workspace</div>
              <h2>{conversation ? 'Start a conversation' : 'Create a conversation'}</h2>
              <p>
                Ask once, compare individual model answers, inspect peer review,
                then read the chairman synthesis.
              </p>
              {conversation && (
                <div className="prompt-grid">
                  {SUGGESTED_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => setInput(prompt)}
                      className="prompt-chip"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            conversation.messages.map((message, index) => (
              <div key={index} className="message-group">
                {message.role === 'user' ? (
                  <div className="user-message">
                    <div className="user-bubble">
                      <ReactMarkdown>{message.content}</ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <div className="assistant-message">
                    <div className="assistant-label">
                      <span className="assistant-mark">C</span>
                      <span>Council</span>
                    </div>
                    <CouncilResponse message={message} />
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <form className="input-form" onSubmit={handleSubmit}>
        <div className="composer-shell">
          <textarea
            ref={textareaRef}
            className="message-input"
            placeholder={
              conversation
                ? 'Ask the council a question...'
                : 'Create a conversation first'
            }
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading || !conversation}
            rows={1}
          />
          <button
            type="submit"
            className="send-button"
            disabled={!canSend}
            aria-label="Send"
          >
            {isLoading ? '...' : '↑'}
          </button>
        </div>
        <div className="composer-meta">
          <span />
          <span>Shift+Enter for newline</span>
        </div>
      </form>
    </main>
  );
}

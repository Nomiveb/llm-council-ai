"use client";

import { useEffect, useState } from 'react';
import { api } from '../api';
import './LogsPage.css';

export default function LogsPage({ currentConversationId }) {
  const [logs, setLogs] = useState([]);
  const [scope, setScope] = useState('all');
  const [error, setError] = useState('');

  const loadLogs = async () => {
    try {
      setError('');
      const payload = await api.listLogs(scope === 'conversation' ? currentConversationId : null);
      setLogs(payload.logs || []);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [scope, currentConversationId]);

  return (
    <main className="logs-page">
      <header className="logs-header">
        <div>
          <p>Observability</p>
          <h2>Run logs</h2>
        </div>
        <button onClick={loadLogs}>Refresh</button>
      </header>
      <div className="logs-toolbar">
        <button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>
          All logs
        </button>
        <button
          className={scope === 'conversation' ? 'active' : ''}
          onClick={() => setScope('conversation')}
          disabled={!currentConversationId}
        >
          Current conversation
        </button>
      </div>
      {error && <div className="logs-error">{error}</div>}
      <div className="logs-list">
        {logs.map((log) => (
          <div className={`log-row ${log.level}`} key={log.id}>
            <div>
              <strong>{log.event}</strong>
              <span>{log.created_at}</span>
            </div>
            <p>
              {log.stage || 'run'} {log.model ? `· ${log.model}` : ''}
              {log.message ? ` · ${log.message}` : ''}
            </p>
            {log.metadata && Object.keys(log.metadata).length > 0 && (
              <pre>{JSON.stringify(log.metadata, null, 2)}</pre>
            )}
          </div>
        ))}
        {logs.length === 0 && <div className="logs-empty">No logs yet. Logs require DATABASE_URL.</div>}
      </div>
    </main>
  );
}

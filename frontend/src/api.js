/**
 * API client for the LLM Council backend.
 */

const API_BASE = '/api';

const fetchWithSession = (url, options = {}) =>
  fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.headers || {}),
    },
  });

export const api = {
  /**
   * List all conversations.
   */
  async listConversations() {
    const response = await fetchWithSession(`${API_BASE}/conversations`);
    if (!response.ok) {
      throw new Error('Failed to list conversations');
    }
    return response.json();
  },

  async getModelConfig() {
    const response = await fetchWithSession(`${API_BASE}/model-config`);
    if (!response.ok) {
      throw new Error('Failed to load model config');
    }
    return response.json();
  },

  async updateModelConfig(config) {
    const response = await fetchWithSession(`${API_BASE}/model-config`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail || 'Failed to update model config');
    }
    return response.json();
  },

  async getApiKeyConfig() {
    const response = await fetchWithSession(`${API_BASE}/api-key-config`);
    if (!response.ok) {
      throw new Error('Failed to load API key config');
    }
    return response.json();
  },

  async updateApiKeyConfig(openrouterApiKey) {
    const response = await fetchWithSession(`${API_BASE}/api-key-config`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ openrouter_api_key: openrouterApiKey }),
    });
    if (!response.ok) {
      throw new Error('Failed to update API key');
    }
    return response.json();
  },

  async listOpenRouterModels() {
    const response = await fetchWithSession(`${API_BASE}/openrouter-models`);
    if (!response.ok) {
      throw new Error('Failed to load OpenRouter models');
    }
    return response.json();
  },

  /**
   * Create a new conversation.
   */
  async createConversation() {
    const response = await fetchWithSession(`${API_BASE}/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      throw new Error('Failed to create conversation');
    }
    return response.json();
  },

  /**
   * Get a specific conversation.
   */
  async getConversation(conversationId) {
    const response = await fetchWithSession(
      `${API_BASE}/conversations/${conversationId}`
    );
    if (!response.ok) {
      throw new Error('Failed to get conversation');
    }
    return response.json();
  },

  async deleteConversation(conversationId) {
    const response = await fetchWithSession(`${API_BASE}/conversations/${conversationId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to delete conversation');
    }
    return response.json();
  },

  async deleteConversations(conversationIds) {
    const response = await fetchWithSession(`${API_BASE}/conversations/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ conversation_ids: conversationIds }),
    });
    if (!response.ok) {
      throw new Error('Failed to delete conversations');
    }
    return response.json();
  },

  async deleteEmptyConversations(exceptId = null) {
    const url = exceptId
      ? `${API_BASE}/conversations/delete-empty?except_id=${encodeURIComponent(exceptId)}`
      : `${API_BASE}/conversations/delete-empty`;
    const response = await fetchWithSession(url, { method: 'POST' });
    if (!response.ok) {
      throw new Error('Failed to delete empty conversations');
    }
    return response.json();
  },

  async listLogs(conversationId = null) {
    const suffix = conversationId ? `?conversation_id=${encodeURIComponent(conversationId)}` : '';
    const response = await fetchWithSession(`${API_BASE}/logs${suffix}`);
    if (!response.ok) {
      throw new Error('Failed to load logs');
    }
    return response.json();
  },

  /**
   * Send a message in a conversation.
   */
  async sendMessage(conversationId, content) {
    const response = await fetchWithSession(
      `${API_BASE}/conversations/${conversationId}/message`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to send message');
    }
    return response.json();
  },

  /**
   * Send a message and receive streaming updates.
   * @param {string} conversationId - The conversation ID
   * @param {string} content - The message content
   * @param {function} onEvent - Callback function for each event: (eventType, data) => void
   * @returns {Promise<void>}
   */
  async sendMessageStream(conversationId, content, onEvent) {
    const response = await fetchWithSession(
      `${API_BASE}/conversations/${conversationId}/message/stream`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to send message');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          try {
            const event = JSON.parse(data);
            onEvent(event.type, event);
          } catch (e) {
            console.error('Failed to parse SSE event:', e);
          }
        }
      }
    }
  },
};

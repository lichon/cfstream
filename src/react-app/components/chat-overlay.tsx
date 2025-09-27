import React, { useState, useEffect, useRef } from 'react';

export interface ChatMessage {
  content: string;
  timestamp: string;
  sender: string;
}

interface ChatOverlayProps {
  show: boolean;
  messages: ChatMessage[];
  onSubmit: (message: string) => void;
}

export const ChatOverlay: React.FC<ChatOverlayProps> = ({ show, messages, onSubmit: onSend }) => {
  const [inputMessage, setInputMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (show) {
      inputRef.current?.focus();
    }
  }, [show]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputMessage.trim()) {
      onSend(inputMessage);
      setInputMessage('');
    }
  };

  return (
    <>
      {show && (
        <div
          style={{
            position: 'fixed',
            bottom: '0',
            width: '100%',
            maxHeight: '40%',
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            padding: '10px',
            overflow: 'auto',
            zIndex: 1000,
            borderRadius: '0.5rem',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ flex: 1, overflowY: 'auto', marginBottom: '10px' }}>
            {messages.map((msg, index) => (
              <div
                key={index}
                style={{
                  marginBottom: '8px',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  textAlign: 'left',
                  width: '100%',
                }}
              >
                <span style={{ opacity: 0.7, fontSize: '12px' }}>
                  {new Date(msg.timestamp).toLocaleTimeString()} - {msg.sender}:{' '}
                </span>
                <span style={{ color: '#fff' }}>{msg.content}</span>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '10px' }}>
            <input
              ref={inputRef}
              maxLength={144}
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onBlur={() => window.scrollTo({ top: 0, left: 0, behavior: 'smooth' })}
              style={{
                flex: 1,
                padding: '8px',
                borderRadius: '0.5rem',
                border: 'none',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                color: 'white',
                outline: 'none',
              }}
              placeholder="Type a message..."
            />
            <button
              type="submit"
              style={{
                marginRight: '8px',
                padding: '8px 16px',
                borderRadius: '0.5rem',
                border: 'none',
                backgroundColor: '#4CAF50',
                color: 'white',
                cursor: 'pointer',
              }}
              onClick={() => inputRef.current?.focus()}
            >
              Send
            </button>
            <div>
            </div>
          </form>
        </div>
      )}
    </>
  );
};
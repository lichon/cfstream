import React, { useState, useEffect, useRef } from 'react';

export interface ChatMessage {
  content: string;
  timestamp: string;
  sender: string;
}

interface ChatOverlayProps {
  show: boolean;
  messages: ChatMessage[];
  online: boolean;
  onSubmit: (message: string) => void;
}

export const ChatOverlay: React.FC<ChatOverlayProps> = ({ show, messages, online, onSubmit }) => {
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
      onSubmit(inputMessage);
      setInputMessage('');
    }
  };

  return (
    <>
      {show && (
        <div
          className="fixed bottom-0 w-full max-h-[40%] bg-black/80 text-white p-2 overflow-auto z-[1000] rounded-lg flex flex-col"
        >
          <div className="flex-1 overflow-y-auto">
            {messages.map((msg, index) => (
              <div
                key={index}
                className="mb-2 text-xs font-mono whitespace-pre-wrap break-words text-left w-full"
              >
                <span className="opacity-70 text-xs">
                  {new Date(msg.timestamp).toLocaleTimeString()} - {msg.sender}:{' '}
                </span>
                <span className="text-white">{msg.content}</span>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              name='input-chat'
              ref={inputRef}
              maxLength={144}
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onBlur={() => window.scrollTo({ top: 0, left: 0, behavior: 'smooth' })}
              className="flex-1 p-2 rounded-lg border-none bg-white/10 text-white outline-none"
              placeholder="Type a message..."
            />
            <button
              type="submit"
              className={`mr-0 px-4 py-2 rounded-lg border-none ${
                online
                  ? 'bg-green-600 hover:bg-green-700 cursor-pointer'
                  : 'bg-gray-500 cursor-not-allowed'
              } text-white`}
              onClick={() => inputRef.current?.focus()}
            >
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
};
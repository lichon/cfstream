import React, { useState, useEffect, useRef } from 'react'

export interface ChatMessage {
  content: string
  timestamp: string
  sender: string
}

interface ChatOverlayProps {
  show: boolean
  messages: ChatMessage[]
  online: boolean
  onSubmit: (message: string) => void
}

export const ChatOverlay: React.FC<ChatOverlayProps> = ({ show, messages, online, onSubmit }) => {
  const [inputMessage, setInputMessage] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    if (show) {
      inputRef.current?.focus()
    }
  }, [show])

  useEffect(() => {
    // inject once: hide scrollbar utility
    if (!document.getElementById('no-scrollbar-style')) {
      const style = document.createElement('style')
      style.id = 'no-scrollbar-style'
      style.textContent = `.no-scrollbar::-webkit-scrollbar{display:none;} .no-scrollbar{scrollbar-width:none;-ms-overflow-style:none;}`
      document.head.appendChild(style)
    }
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (inputMessage.trim()) {
      onSubmit(inputMessage)
      setInputMessage('')
    }
  }

  return (
    <>
      {show && (
        <div
          className="fixed bottom-0 w-full max-h-[30%] bg-black/80 text-white p-2 overflow-auto z-[1000] rounded-lg flex flex-col"
        >
          <div className="flex-1 overflow-y-auto no-scrollbar mb-2">
            {messages.map((msg, index) => (
              <div
                key={index}
                className="mb-2 text-sm font-mono whitespace-pre-wrap break-words text-left w-full"
              >
                <span className="opacity-50">
                  {new Date(msg.timestamp).toLocaleTimeString()} - {msg.sender}:{' '}
                </span>
                <span className="opacity-80 text-white">{msg.content}</span>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              name='input-chat'
              ref={inputRef}
              maxLength={256}
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onBlur={() => window.scrollTo({ top: 0, left: 0, behavior: 'smooth' })}
              className="flex-1 p-2 rounded-lg border-none bg-white/10 text-white outline-none"
              placeholder="Type a message..."
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <button
              type="submit"
              className={`mr-0 px-4 py-2 rounded-lg border-none ${
                online
                  ? 'bg-green-500 hover:bg-green-700 cursor-pointer'
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
  )
}